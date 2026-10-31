"""A small log-power spectrogram for the dashboard, computed with NumPy only (no librosa dependency).

The output is deliberately coarse: at most `columns` time steps and `bins` frequency rows, each value an integer 0-255
(0 = quietest, 255 = loudest, over an 80 dB range). It is a picture for a person to read next to the flagged windows,
not a model input."""

import numpy as np

from app.services.audio_io import TARGET_SAMPLE_RATE

N_FFT = 512  # 32 ms at 16 kHz; frequency resolution 31.25 Hz
DB_RANGE = 80.0


def spectrogram(audio: np.ndarray, sample_rate: int = TARGET_SAMPLE_RATE, columns: int = 240, bins: int = 64) -> dict:
    if len(audio) < N_FFT:
        audio = np.pad(audio, (0, N_FFT - len(audio)))
    hop = max((len(audio) - N_FFT) // max(columns - 1, 1), 1)
    frames = 1 + (len(audio) - N_FFT) // hop
    window = np.hanning(N_FFT).astype(np.float32)
    # Strided view: one row per frame, no copy until the multiply.
    idx = np.arange(N_FFT)[None, :] + hop * np.arange(frames)[:, None]
    power = np.abs(np.fft.rfft(audio[idx] * window, axis=1)) ** 2  # (frames, N_FFT/2 + 1)
    # Average neighbouring frequency bins down to `bins` rows, keeping the whole band (0 to sample_rate / 2).
    edges = np.linspace(0, power.shape[1], bins + 1).astype(int)
    reduced = np.stack([power[:, a:b].mean(axis=1) if b > a else power[:, a] for a, b in zip(edges[:-1], edges[1:])], axis=1)
    db = 10 * np.log10(reduced + 1e-10)
    top = float(db.max())
    scaled = np.clip((db - (top - DB_RANGE)) / DB_RANGE, 0, 1) * 255
    return {
        "hop_seconds": round(hop / sample_rate, 5),
        "duration_seconds": round(len(audio) / sample_rate, 3),
        "freq_max_hz": sample_rate // 2,
        "bins": bins,
        # Rows are time, columns are frequency (low to high); the frontend transposes when drawing.
        "values": scaled.astype(np.uint8).tolist(),
    }
