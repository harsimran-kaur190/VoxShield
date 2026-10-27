"""Loader for the NII Yamagishi Lab "AntiDeepfake" detectors (https://huggingface.co/nii-yamagishilab).

Their checkpoints are a fairseq wav2vec2 encoder (`m_ssl.model.*`), mean pooling over time, and one linear layer
(`proj_fc`) giving two logits in the order <fake, real>. fairseq does not install on current Python, so the encoder
weights are mapped by name onto the equivalent Hugging Face `Wav2Vec2Model` (pre-layer-norm, "stable" variant), the
same mapping as transformers' own fairseq conversion script. Nothing is retrained or changed.

The weights are licensed CC BY-NC-SA 4.0: research and non-commercial use only.
"""

import re
from typing import Any

from app.config import Settings

FAKE_INDEX = 0  # the model card: "<Fake score, Real score>"

# fairseq name -> Hugging Face name, applied in order to keys with the "m_ssl.model." prefix removed.
_RENAMES: list[tuple[str, str]] = [
    (r"^feature_extractor\.conv_layers\.(\d+)\.0\.", r"feature_extractor.conv_layers.\1.conv."),
    (r"^feature_extractor\.conv_layers\.(\d+)\.2\.1\.", r"feature_extractor.conv_layers.\1.layer_norm."),
    (r"^post_extract_proj\.", "feature_projection.projection."),
    (r"^layer_norm\.", "feature_projection.layer_norm."),
    (r"^encoder\.pos_conv\.0\.weight_g$", "encoder.pos_conv_embed.conv.parametrizations.weight.original0"),
    (r"^encoder\.pos_conv\.0\.weight_v$", "encoder.pos_conv_embed.conv.parametrizations.weight.original1"),
    (r"^encoder\.pos_conv\.0\.bias$", "encoder.pos_conv_embed.conv.bias"),
    (r"^encoder\.layers\.(\d+)\.self_attn\.", r"encoder.layers.\1.attention."),
    (r"^encoder\.layers\.(\d+)\.self_attn_layer_norm\.", r"encoder.layers.\1.layer_norm."),
    (r"^encoder\.layers\.(\d+)\.fc1\.", r"encoder.layers.\1.feed_forward.intermediate_dense."),
    (r"^encoder\.layers\.(\d+)\.fc2\.", r"encoder.layers.\1.feed_forward.output_dense."),
    (r"^mask_emb$", "masked_spec_embed"),
]
# Pre-training parts the detector never uses.
_UNUSED = re.compile(r"^(quantizer\.|project_q\.|final_proj\.)")


def map_encoder_weights(state: dict[str, Any]) -> dict[str, Any]:
    mapped: dict[str, Any] = {}
    for key, value in state.items():
        if not key.startswith("m_ssl.model."):
            continue
        name = key[len("m_ssl.model."):]
        if _UNUSED.match(name):
            continue
        for pattern, replacement in _RENAMES:
            name = re.sub(pattern, replacement, name)
        mapped[name] = value
    return mapped


def load_nii_detector(settings: Settings):
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    from transformers import Wav2Vec2Config, Wav2Vec2FeatureExtractor, Wav2Vec2Model

    from app.services.voice_authenticity import LoadedClassifier

    revision = settings.effective_voice_revision
    config = Wav2Vec2Config.from_pretrained(settings.voice_model_id, revision=revision)
    config.layerdrop, config.apply_spec_augment = 0.0, False
    for field in ("hidden_dropout", "attention_dropout", "activation_dropout", "feat_proj_dropout", "final_dropout"):
        setattr(config, field, 0.0)
    state = load_file(hf_hub_download(settings.voice_model_id, "model.safetensors", revision=revision))

    encoder = Wav2Vec2Model(config)
    missing, unexpected = encoder.load_state_dict(map_encoder_weights(state), strict=False)
    if missing or unexpected:
        raise ValueError(f"Weight mapping incomplete: missing={missing[:3]} unexpected={unexpected[:3]}")
    head = torch.nn.Linear(config.hidden_size, 2)
    head.load_state_dict({"weight": state["proj_fc.weight"], "bias": state["proj_fc.bias"]})

    class Detector(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder, self.head = encoder, head

        def forward(self, input_values, attention_mask=None):
            hidden = self.encoder(input_values, attention_mask=attention_mask).last_hidden_state
            return type("Output", (), {"logits": self.head(hidden.mean(dim=1))})()

    model = Detector().to(settings.voice_device).eval()
    # The original normalizes the whole waveform to zero mean and unit variance, which is what do_normalize does.
    extractor = Wav2Vec2FeatureExtractor(feature_size=1, sampling_rate=16000, padding_value=0.0, do_normalize=True, return_attention_mask=False)
    torch.set_grad_enabled(False)
    return LoadedClassifier(extractor=extractor, model=model, fake_index=FAKE_INDEX)
