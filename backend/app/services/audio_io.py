from pathlib import Path

import av
import numpy as np

TARGET_SAMPLE_RATE = 16_000


class AudioDecodeError(Exception):
    pass


def load_mono_16k(path: Path, max_seconds: float | None = None) -> np.ndarray:
    """Decode any supported audio file to mono float32 at 16 kHz.

    Header-declared durations can be wrong, so max_seconds caps what is actually decoded.
    """
    limit = int(max_seconds * TARGET_SAMPLE_RATE) if max_seconds else None
    total = 0
    resampler = av.AudioResampler(format="flt", layout="mono", rate=TARGET_SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    try:
        with av.open(str(path), mode="r") as container:
            if not container.streams.audio:
                raise AudioDecodeError("The file contains no audio stream.")
            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    chunk = converted.to_ndarray().reshape(-1)
                    total += len(chunk)
                    if limit is not None and total > limit:
                        raise AudioDecodeError("The audio is longer than its header claims and exceeds the allowed duration.")
                    chunks.append(chunk)
            for converted in resampler.resample(None):
                chunks.append(converted.to_ndarray().reshape(-1))
    except AudioDecodeError:
        raise
    except Exception as error:
        raise AudioDecodeError("The audio could not be decoded.") from error
    if not chunks:
        raise AudioDecodeError("The file contains no decodable audio.")
    return np.concatenate(chunks).astype(np.float32, copy=False)
