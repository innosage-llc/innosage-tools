import type { SceneNode } from './visual-remix.ts';
import { REMIX_FONTS } from './visual-remix-renderer.ts';

export { REMIX_FONTS };

export type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

export type Point = { x: number; y: number };

export type BoxBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Transforms a canvas-space point (cx, cy) to local node coordinates (lx, ly),
 * where the node origin (0, 0) is at (node.x, node.y) and rotated by node.rotation degrees.
 */
export function toLocalPoint(cx: number, cy: number, node: SceneNode): Point {
  const rad = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = cx - node.x;
  const dy = cy - node.y;
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

/**
 * Transforms a local node point (lx, ly) to canvas-space coordinates (cx, cy).
 */
export function toCanvasPoint(lx: number, ly: number, node: SceneNode): Point {
  const rad = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: node.x + lx * cos - ly * sin,
    y: node.y + lx * sin + ly * cos,
  };
}

/**
 * Tests whether canvas coordinate (cx, cy) falls within the geometry of node.
 * Evaluates in local coordinates with exact shape boundaries:
 * - Rect, Image, Text: axis-aligned local box [0, width] x [0, height]
 * - Ellipse: centered at (width/2, height/2) with radii width/2 and height/2
 */
export function isPointInNode(cx: number, cy: number, node: SceneNode): boolean {
  const local = toLocalPoint(cx, cy, node);
  if (node.type === 'ellipse') {
    const rx = node.width / 2;
    const ry = node.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (local.x - rx) / rx;
    const ny = (local.y - ry) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height;
}

/**
 * Hit tests canvas coordinates (cx, cy) against scene nodes in z-order.
 * Nodes later in the array are rendered on top, so testing proceeds from top (last) to bottom (first).
 * Returns the topmost hit node, or null if clicking on blank canvas.
 */
export function hitTest(cx: number, cy: number, nodes: SceneNode[]): SceneNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (isPointInNode(cx, cy, node)) {
      return node;
    }
  }
  return null;
}

/**
 * Clamps bounding box values to guarantee compliance with parseScene schema:
 * x in [0, 1080 - width], y in [0, 1440 - height], width in [1, 1080], height in [1, 1440].
 * Also clamps cornerRadius for rect nodes to at most min(width, height) / 2.
 */
export function clampNodeBox(box: BoxBounds, originalNode: SceneNode): BoxBounds & { cornerRadius?: number } {
  let width = Math.max(1, Math.min(1080, Math.round(box.width * 10) / 10));
  let height = Math.max(1, Math.min(1440, Math.round(box.height * 10) / 10));
  const x = Math.max(0, Math.min(1080 - width, Math.round(box.x * 10) / 10));
  const y = Math.max(0, Math.min(1440 - height, Math.round(box.y * 10) / 10));

  if (x + width > 1080) {
    width = Math.max(1, 1080 - x);
  }
  if (y + height > 1440) {
    height = Math.max(1, 1440 - y);
  }

  const patch: BoxBounds & { cornerRadius?: number } = { x, y, width, height };
  if (originalNode.type === 'rect') {
    patch.cornerRadius = Math.max(0, Math.min(originalNode.cornerRadius, Math.min(width, height) / 2));
  }
  return patch;
}

/**
 * Calculates new geometry when resizing a rotated bounding box via one of its 8 handles.
 * The opposite anchor point remains fixed in canvas coordinates while the dragged handle maps to pointer.
 */
export function resizeRotatedBox(
  handle: HandleType,
  startNode: SceneNode,
  pointerX: number,
  pointerY: number
): BoxBounds & { cornerRadius?: number } {
  const p=toLocalPoint(pointerX,pointerY,startNode);
  const width=Math.max(1,Math.min(1080,handle.includes('w')?startNode.width-p.x:handle.includes('e')?p.x:startNode.width));
  const height=Math.max(1,Math.min(1440,handle.includes('n')?startNode.height-p.y:handle.includes('s')?p.y:startNode.height));
  const origin=toCanvasPoint(handle.includes('w')?startNode.width-width:0,handle.includes('n')?startNode.height-height:0,startNode);
  return clampNodeBox({...origin,width,height},startNode);
}

/**
 * Calculates new rotation in degrees [-180, 180] when dragging the rotation handle.
 * Rotation center is the center of the bounding box.
 */
export function rotateBox(startNode: SceneNode, pointerX: number, pointerY: number): number {
  const rad = (startNode.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = startNode.x + (startNode.width / 2) * cos - (startNode.height / 2) * sin;
  const cy = startNode.y + (startNode.width / 2) * sin + (startNode.height / 2) * cos;
  const dx = pointerX - cx;
  const dy = pointerY - cy;
  const ang = Math.atan2(dy, dx) * (180 / Math.PI);
  let rot = ang + 90;
  while (rot > 180) rot -= 360;
  while (rot < -180) rot += 360;
  return Math.max(-180, Math.min(180, Math.round(rot)));
}

/**
 * Computes dragged node position clamped to canvas bounds [0, 1080 - width] x [0, 1440 - height].
 */
export function dragNode(startNode: SceneNode, deltaX: number, deltaY: number): { x: number; y: number } {
  const x = Math.max(0, Math.min(1080 - startNode.width, Math.round((startNode.x + deltaX) * 10) / 10));
  const y = Math.max(0, Math.min(1440 - startNode.height, Math.round((startNode.y + deltaY) * 10) / 10));
  return { x, y };
}

/**
 * Computes center alignment coordinates on canvas for axis 'x' or 'y'.
 */
export function centerNode(node: SceneNode, axis: 'x' | 'y'): { x?: number; y?: number } {
  const radians=node.rotation*Math.PI/180;
  const offsetX=(node.width*Math.cos(radians)-node.height*Math.sin(radians))/2;
  const offsetY=(node.width*Math.sin(radians)+node.height*Math.cos(radians))/2;
  return axis==='x' ? {x:Math.max(0,Math.min(1080-node.width,Math.round((540-offsetX)*10)/10))}
    : {y:Math.max(0,Math.min(1440-node.height,Math.round((720-offsetY)*10)/10))};
}

/**
 * Returns the 4 corner points of a node in canvas coordinates [TL, TR, BR, BL].
 */
export function getRotatedCorners(node: SceneNode): [Point, Point, Point, Point] {
  return [
    toCanvasPoint(0, 0, node),
    toCanvasPoint(node.width, 0, node),
    toCanvasPoint(node.width, node.height, node),
    toCanvasPoint(0, node.height, node),
  ];
}
