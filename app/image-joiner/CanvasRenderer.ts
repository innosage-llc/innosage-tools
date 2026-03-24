import { TransformState } from './page';

export interface RenderParams {
  image: File | string;
  transform: TransformState;
}

const loadImage = (imageSource: File | string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let urlToRevoke: string | null = null;

    const cleanup = () => {
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
        urlToRevoke = null;
      }
    };

    img.onload = () => {
      cleanup();
      resolve(img);
    };

    img.onerror = (err) => {
      cleanup();
      reject(new Error('Failed to load image: ' + err));
    };

    if (typeof imageSource === 'string') {
      img.crossOrigin = 'anonymous';
      img.src = imageSource;
    } else {
      urlToRevoke = URL.createObjectURL(imageSource);
      img.src = urlToRevoke;
    }
  });
};

export async function renderJoinedImage(leftParams: RenderParams, rightParams: RenderParams): Promise<Blob> {
  const [leftImage, rightImage] = await Promise.all([
    loadImage(leftParams.image),
    loadImage(rightParams.image)
  ]);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get 2D context');
  }

  // Use a high-res multiplier
  const scaleMultiplier = typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2;

  // We assume both viewports are exactly the same size on screen as enforced by our CSS Grid
  const viewportWidth = leftParams.transform.viewportWidth;
  const viewportHeight = leftParams.transform.viewportHeight;

  // The final canvas will be 2x viewport width (left + right), and 1x viewport height
  canvas.width = (viewportWidth * 2) * scaleMultiplier;
  canvas.height = viewportHeight * scaleMultiplier;

  // Clear canvas
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawImageWithTransform = (
    img: HTMLImageElement,
    transform: TransformState,
    offsetX: number // 0 for left, viewportWidth for right
  ) => {
    ctx.save();

    // 1. Move to the specific viewport's starting X coordinate (scaled)
    ctx.translate(offsetX * scaleMultiplier, 0);

    // Create a clipping path for this half so we don't draw outside the viewport bounds
    ctx.beginPath();
    ctx.rect(0, 0, viewportWidth * scaleMultiplier, viewportHeight * scaleMultiplier);
    ctx.clip();

    // 2. The 'react-zoom-pan-pinch' positionX/Y and scale are relative to the viewport.
    // We apply them to the canvas context.
    const scaledX = transform.positionX * scaleMultiplier;
    const scaledY = transform.positionY * scaleMultiplier;
    ctx.translate(scaledX, scaledY);
    ctx.scale(transform.scale, transform.scale); // Don't multiply scale by scaleMultiplier here, the context handles it

    // 3. To match 'react-zoom-pan-pinch' transform origin behavior (which centers by default),
    // we need to calculate where to draw the image.
    // The library centers the content within the wrapper.
    const scaledImgWidth = transform.originalWidth;
    const scaledImgHeight = transform.originalHeight;

    // By default, the transform component centers the content within the wrapper
    // if the content is smaller than the wrapper.
    const startX = Math.max(0, (viewportWidth - scaledImgWidth) / 2);
    const startY = Math.max(0, (viewportHeight - scaledImgHeight) / 2);

    ctx.drawImage(img, startX, startY, transform.originalWidth, transform.originalHeight);

    ctx.restore();
  };

  drawImageWithTransform(leftImage, leftParams.transform, 0);
  drawImageWithTransform(rightImage, rightParams.transform, viewportWidth);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas to Blob failed'));
      }
    }, 'image/png', 1.0);
  });
}
