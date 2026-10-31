from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# NII Yamagishi Lab AntiDeepfake, MMS-300M backbone (CC BY-NC-SA 4.0: non-commercial use only). Chosen over the earlier
# Gustking ASVspoof-2019 model on VoxShield's English/Hindi/Punjabi benchmark: see backend/evaluation/VOICE_RESULTS.md.
DEFAULT_VOICE_MODEL_ID = "nii-yamagishilab/mms-300m-anti-deepfake"
DEFAULT_VOICE_MODEL_REVISION = "7928e119e09f616b2ce698892e00ca22dbaa40bf"
# A second detector run on every recording (Apache-2.0). It counts only on full-band audio: there it never called a real
# voice fake in VoxShield's benchmark, and it caught a TTSMaker voice the default model scored as real. Over Opus it
# called 4 of 119 real voices fake and caught nothing extra, so on phone or VoIP audio it is shown but does not decide.
# Empty disables it.
DEFAULT_VOICE_SECONDARY_MODEL_ID = "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification"
DEFAULT_VOICE_SECONDARY_MODEL_REVISION = "f7050b586236dc910d1157f430def2d0647b02b4"
# DeepTruth image detector: UnivFD (Ojha et al., CVPR 2023) = CLIP ViT-L/14 (MIT) + the authors' linear layer (MIT).
# Chosen over two Hugging Face ViT face classifiers after a labelled check: see backend/evaluation/IMAGE_RESULTS.md.
DEFAULT_UNIVFD_CLIP_ID = "openai/clip-vit-large-patch14"
DEFAULT_UNIVFD_CLIP_REVISION = "32bd64288804d66eefd0ccbe215aa642df71cc41"
DEFAULT_UNIVFD_FC_URL = "https://raw.githubusercontent.com/WisconsinAIVision/UniversalFakeDetect/030495aea3300a8b54c0ec37ec7fe1dd7e63c619/pretrained_weights/fc_weights.pth"
DEFAULT_UNIVFD_FC_SHA256 = "477100745713bcc957beb2b40859536859b6483fd6301b3b9293151b194c7847"
# Second member of the image ensemble: a Swin-V2 AI-image classifier (Apache-2.0). On DeepTruth's own check it ranked
# first of five Hugging Face candidates on 2025 generators (AUC 0.91) but is near chance on StyleGAN faces, where UnivFD
# is strong, so the two are averaged (eval/compare_detectors.py, eval/results/detector_comparison.json).
DEFAULT_SWIN_MODEL_ID = "haywoodsloan/ai-image-detector-deploy"
DEFAULT_SWIN_MODEL_REVISION = "4ae1822603cb1ec980c217cfde1ef1b8e0477a16"
# The earlier ViT face classifiers, kept selectable for comparison (VOXSHIELD_IMAGE_DETECTOR=hf). Both Apache-2.0.
DEFAULT_IMAGE_MODEL_ID = "prithivMLmods/Deep-Fake-Detector-v2-Model"
DEFAULT_IMAGE_MODEL_REVISION = "3a99ae26f52c7ac7c3a53103b6cf3a8b617f7093"
DEFAULT_IMAGE_SECONDARY_MODEL_ID = "dima806/deepfake_vs_real_image_detection"
DEFAULT_IMAGE_SECONDARY_MODEL_REVISION = "29e4cf9efc543845610045f6ba7e88e5cf9d9301"
# MediaPipe Face Landmarker (478 points), published by Google under Apache-2.0. Downloaded once and checked by hash.
DEFAULT_FACE_LANDMARKER_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
DEFAULT_FACE_LANDMARKER_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
DEFAULT_SCAM_MODEL_ID = "MoritzLaurer/deberta-v3-base-zeroshot-v2.0"
DEFAULT_SCAM_MODEL_REVISION = "8e7e5af5983a0ddb1a5b45a38b129ab69e2258e8"


EXTENSION_ORIGIN_REGEX = r"chrome-extension://[a-p]{32}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOXSHIELD_", env_file=".env", extra="ignore")

    app_version: str = "0.3.0"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Optional pattern for origins that cannot be listed in advance, such as Vercel preview URLs.
    cors_origin_regex: str | None = None
    # Let the VoxShield Check browser extension call the API. Its requests arrive from a chrome-extension://<id> origin.
    cors_allow_extensions: bool = True
    # Interactive API docs are handy locally and unnecessary on a public server.
    docs_enabled: bool = True
    # Requests allowed per client address per minute on the upload and analysis endpoints. 0 turns the limit off.
    rate_limit_per_minute: int = 20

    max_upload_mb: int = 25
    max_duration_seconds: float = 600
    min_duration_seconds: float = 1

    preload_models: bool = True
    max_concurrent_analyses: int = 4

    whisper_model_size: str = "small"
    whisper_revision: str | None = None
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_language: str | None = None
    whisper_beam_size: int = 5

    voice_model_id: str = DEFAULT_VOICE_MODEL_ID
    voice_model_revision: str | None = DEFAULT_VOICE_MODEL_REVISION
    voice_secondary_model_id: str = DEFAULT_VOICE_SECONDARY_MODEL_ID
    voice_secondary_model_revision: str | None = DEFAULT_VOICE_SECONDARY_MODEL_REVISION
    voice_device: str = "cpu"
    voice_window_seconds: float = 6
    voice_min_window_seconds: float = 2
    voice_min_audio_seconds: float = 4
    voice_max_windows: int = 10
    voice_silence_rms: float = 0.003
    voice_majority_ratio: float = 0.66
    voice_borderline_low: float = 0.4
    voice_borderline_high: float = 0.6
    # Full-band (not phone-quality) audio: the primary model leans "fake" from this window score, with an inconclusive
    # band of +/- voice_full_band_borderline. Chosen on half of VoxShield's benchmark and checked on the other half; see
    # backend/evaluation/VOICE_RESULTS.md. Phone-quality audio keeps the 0.5 rule above. None disables the change.
    voice_full_band_threshold: float | None = 0.2
    voice_full_band_borderline: float = 0.1
    # Audio counts as phone-quality when the band above 4 kHz barely rises with the speech, or is almost empty.
    voice_narrowband_lift_db: float = 6.0
    voice_narrowband_ratio_db: float = -60.0

    # Which scam-intent detector produces the findings: the transparent rules, or the zero-shot NLI model.
    scam_detector: Literal["rules", "nli"] = "nli"
    scam_model_id: str = DEFAULT_SCAM_MODEL_ID
    scam_model_revision: str | None = DEFAULT_SCAM_MODEL_REVISION
    scam_model_device: str = "cpu"
    scam_batch_size: int = 16
    scam_max_pair_tokens: int = 192
    scam_max_pairs: int = 5400
    # Entailment-score cut-offs. They are heuristics chosen on a small development set, not calibrated probabilities.
    scam_nli_threshold: float = 0.92
    scam_nli_uncertain_threshold: float = 0.30
    scam_nli_reported_threshold: float = 0.50
    # Added after the Stage 2 false-positive report. See evaluation/RESULTS.md.
    scam_nli_protective_threshold: float = 0.90
    scam_nli_reported_finding_threshold: float = 0.80
    scam_nli_protective_strict_threshold: float = 0.95
    scam_nli_sender_threshold: float = 0.85

    # ---- DeepTruth upload and video pipeline ----
    # DeepTruth accepts videos, so its upload limit is separate from (and larger than) VoxShield's audio limit.
    deeptruth_max_upload_mb: int = 100
    # Frames per second sampled for the face track (temporal and audio-visual sync checks).
    video_sample_fps: float = 10
    # Only the first part of a long video is analysed frame by frame, to bound time and memory. Said in limitations.
    video_max_analyzed_seconds: float = 60
    # Frames sent to the image classifiers, spread evenly over the analysed part.
    video_classifier_frames: int = 16
    # Frames are scaled down to this longest side before face detection.
    video_frame_max_side: int = 960

    # ---- DeepTruth image pipeline ----
    # "ensemble" (default: UnivFD + Swin-V2, mean of logits), "univfd" alone, or "hf" (the earlier ViT face classifiers).
    image_detector: Literal["ensemble", "univfd", "hf"] = "ensemble"
    swin_model_id: str = DEFAULT_SWIN_MODEL_ID
    swin_model_revision: str | None = DEFAULT_SWIN_MODEL_REVISION
    # Ensemble calibration: score = sigmoid(a * mean_logit + b), fitted on the calibration half of eval/images only
    # (180 images), never on the test half. Re-fit with eval/compare_detectors.py when the members change.
    ensemble_calibration_a: float = 0.453
    ensemble_calibration_b: float = 1.620
    univfd_clip_id: str = DEFAULT_UNIVFD_CLIP_ID
    univfd_clip_revision: str | None = DEFAULT_UNIVFD_CLIP_REVISION
    univfd_fc_path: str = "models/univfd_fc_weights.pth"
    univfd_fc_url: str = DEFAULT_UNIVFD_FC_URL
    univfd_fc_sha256: str | None = DEFAULT_UNIVFD_FC_SHA256
    # score = sigmoid(a * logit(raw) + b). Fitted by evaluation/image_detector_check.py on half of its labelled sample
    # (the other half is the held-out check). Re-run that script and paste its output here to recalibrate.
    univfd_calibration_a: float = 0.523
    univfd_calibration_b: float = 1.966
    image_model_id: str = DEFAULT_IMAGE_MODEL_ID
    image_model_revision: str | None = DEFAULT_IMAGE_MODEL_REVISION
    # Empty disables the second detector.
    image_secondary_model_id: str = DEFAULT_IMAGE_SECONDARY_MODEL_ID
    image_secondary_model_revision: str | None = DEFAULT_IMAGE_SECONDARY_MODEL_REVISION
    image_device: str = "cpu"
    # Images larger than this (longest side, pixels) are scaled down before the forensic filters, to bound CPU time.
    image_max_side: int = 1600
    face_landmarker_path: str = "models/face_landmarker.task"
    face_landmarker_url: str = DEFAULT_FACE_LANDMARKER_URL
    face_landmarker_sha256: str | None = DEFAULT_FACE_LANDMARKER_SHA256
    face_max_faces: int = 5

    # ---- Live calls (browser-to-browser, analysed while they happen) ----
    # Rooms live in this process's memory only, so run a single API worker when calls are used.
    call_max_rooms: int = 200
    # Empty rooms (nobody in them) one client address may hold at once, so one visitor cannot use up the server-wide cap
    # by creating rooms and abandoning them. Rooms in use do not count: behind a proxy without forwarded headers every
    # visitor shares one address, and real calls must never be blocked by this.
    call_max_rooms_per_client: int = 10
    # A room nobody has joined, or that everyone has left, is removed after this long.
    call_room_idle_seconds: float = 600
    # How long a participant whose connection dropped keeps their place before the other side is told they left.
    call_reconnect_grace_seconds: float = 20
    # Each analysis reads the last `window` seconds of the other person's audio, at most every `step` seconds of new
    # audio. 12 s gives Whisper whole sentences and the voice model two 6 s windows; 5 s new audio bounds alert latency
    # at roughly step + inference time. Windows overlap, and repeated findings are not alerted twice.
    call_analysis_window_seconds: float = 12
    call_analysis_step_seconds: float = 5
    # Below this level (RMS of 16 kHz float audio) a window is treated as silence and not sent to the models.
    call_silence_rms: float = 0.004
    # Largest single audio frame accepted from a browser, and the largest burst above real time (the browser buffers up to
    # about 8 s of audio while its connection stalls, then sends it at once).
    call_max_frame_seconds: float = 2
    call_max_ahead_seconds: float = 8
    # After this long, a running analysis is reported to the listener as delayed (it is not cancelled: a model run in a
    # worker thread cannot be interrupted safely).
    call_analysis_delay_seconds: float = 20
    # A finding of the same kind is not alerted again within this many seconds unless the risk level rises.
    call_alert_cooldown_seconds: float = 45
    # ICE servers handed to call participants. STUN is enough on most home networks; TURN relays media when a direct
    # path cannot be found (strict NAT, many corporate networks). With turn_secret set, short-lived credentials are
    # issued per participant using the TURN REST convention (coturn: use-auth-secret / static-auth-secret).
    call_stun_urls: list[str] = ["stun:stun.l.google.com:19302"]
    turn_urls: list[str] = []
    turn_secret: str | None = None
    turn_credential_ttl_seconds: int = 3600

    @property
    def effective_scam_revision(self) -> str | None:
        if self.scam_model_id == DEFAULT_SCAM_MODEL_ID:
            return self.scam_model_revision
        return self.scam_model_revision if self.scam_model_revision != DEFAULT_SCAM_MODEL_REVISION else None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def cors_regex(self) -> str | None:
        """The configured origin pattern, plus Chrome/Edge extension origins (32 lowercase letters a-p) when allowed."""
        patterns = [p for p in (self.cors_origin_regex, EXTENSION_ORIGIN_REGEX if self.cors_allow_extensions else None) if p]
        return "|".join(f"(?:{p})" for p in patterns) or None

    @property
    def deeptruth_max_upload_bytes(self) -> int:
        return self.deeptruth_max_upload_mb * 1024 * 1024

    @property
    def effective_voice_revision(self) -> str | None:
        if self.voice_model_id == DEFAULT_VOICE_MODEL_ID:
            return self.voice_model_revision
        return self.voice_model_revision if self.voice_model_revision != DEFAULT_VOICE_MODEL_REVISION else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
