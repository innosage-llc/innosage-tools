export interface ViewportState {
  image: HTMLImageElement | null;
  scale: number;
  positionX: number;
  positionY: number;
  imageWidth: number;  // natural width of the image
  imageHeight: number; // natural height of the image
}

export async function renderJoinedImage(
  leftState: ViewportState,
  rightState: ViewportState,
  viewportWidth: number,
  viewportHeight: number,
  pixelRatio: number = 2
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get 2d context for canvas');
      }

      // Output canvas is 2x viewport width
      canvas.width = viewportWidth * 2 * pixelRatio;
      canvas.height = viewportHeight * pixelRatio;

      // Fill with background to match the #f4f4f5 zinc-100 UI background for transparent images
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Function to draw one side
      const drawSide = (state: ViewportState, dxOffset: number) => {
        if (!state.image) return;

        ctx.save();

        // Setup clip region for this half of the canvas
        ctx.beginPath();
        ctx.rect(dxOffset * pixelRatio, 0, viewportWidth * pixelRatio, viewportHeight * pixelRatio);
        ctx.clip();

        // The transform library (react-zoom-pan-pinch) positions the element using:
        // transform: translate(positionX px, positionY px) scale(scale)
        // on the TransformComponent content div.
        // It's applied to the content div, which contains the image.
        // The image scales and moves based on these values relative to the viewport container.

        // Calculate the destination rectangle in the canvas coordinates
        // Canvas dest coords:
        const dx = dxOffset * pixelRatio + state.positionX * pixelRatio;
        const dy = state.positionY * pixelRatio;

        // Calculate the scaled image size
        const dw = state.imageWidth * state.scale * pixelRatio;
        const dh = state.imageHeight * state.scale * pixelRatio;

        // Note: For a standard image scaled/panned inside a container with overflow:hidden,
        // we can just draw the entire image at the calculated dx/dy and size, and let
        // canvas clipping handle the viewport.
        // If react-zoom-pan-pinch applies transforms slightly differently (e.g. centering),
        // we might need to adjust. Usually, positionX/Y are relative to the top-left of the wrapper
        // when using limitToBounds or similar, but react-zoom-pan-pinch can also set origin.
        // Assuming default top-left origin for transform if not specified,
        // or we just trust positionX/Y are the final offsets.

        ctx.drawImage(
          state.image,
          dx,
          dy,
          dw,
          dh
        );

        ctx.restore();
      };

      drawSide(leftState, 0);
      drawSide(rightState, viewportWidth);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob failed'));
        }
      }, 'image/jpeg', 0.95); // High quality JPEG
    } catch (e) {
      reject(e);
    }
  });
}
