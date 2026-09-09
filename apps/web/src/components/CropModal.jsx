import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";

async function getCroppedBlob(imageSrc, cropPixels, fileType) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height
  );

  return new Promise((resolve) => canvas.toBlob(resolve, fileType || "image/jpeg", 0.92));
}

export default function CropModal({ imageSrc, fileType, fileName, onCancel, onDone }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_, pixels) => setCroppedAreaPixels(pixels), []);

  const applyCrop = async () => {
    if (!croppedAreaPixels) return onDone(null);
    setBusy(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels, fileType);
      const croppedFile = new File([blob], fileName, { type: fileType || "image/jpeg" });
      onDone(croppedFile);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crop-overlay">
      <div className="crop-box">
        <div className="crop-area">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={undefined}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="crop-controls">
          <label>Zoom</label>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => onCancel()} disabled={busy}>
            Skip crop
          </button>
          <button className="btn btn-primary" onClick={applyCrop} disabled={busy}>
            {busy ? "Applying..." : "Use cropped image"}
          </button>
        </div>
      </div>
    </div>
  );
}
