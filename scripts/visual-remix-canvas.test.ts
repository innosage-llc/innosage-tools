import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, parseScene, type Scene, type SceneNode } from '../lib/visual-remix.ts';
import { LocalAssets } from '../lib/visual-remix-assets.ts';
import { VisualRemixController, type RenderedScene } from '../lib/visual-remix-controller.ts';
import {
  hitTest,
  isPointInNode,
  resizeRotatedBox,
  rotateBox,
  dragNode,
  centerNode,
  clampNodeBox,
  toLocalPoint,
  toCanvasPoint,
} from '../lib/visual-remix-canvas.ts';

const rendered = (s: Scene): RenderedScene => ({
  png: new Blob([JSON.stringify(s)]),
  diagnostics: [],
});

function testScene(): Scene {
  return {
    ...emptyScene(),
    nodes: [
      {
        id: 'rect1',
        type: 'rect',
        x: 100,
        y: 100,
        width: 300,
        height: 200,
        rotation: 0,
        opacity: 1,
        fill: '#336699',
        cornerRadius: 10,
      },
      {
        id: 'ellipse1',
        type: 'ellipse',
        x: 300,
        y: 200,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        fill: '#993366',
      },
      {
        id: 'text1',
        type: 'text',
        x: 150,
        y: 150,
        width: 400,
        height: 100,
        rotation: 0,
        opacity: 1,
        text: 'Visual Remix 直接编辑',
        font: 'sans',
        fontSize: 36,
        fontWeight: 'bold',
        lineHeight: 1.3,
        align: 'left',
        wrap: 'word',
        fill: '#111111',
      },
    ],
  };
}

test('hit-testing: accurate shape boundaries and z-order hit resolution', () => {
  const scene = testScene();

  // Test 1: Hit test on blank canvas returns null (blank deselection)
  assert.equal(hitTest(10, 10, scene.nodes), null);
  assert.equal(hitTest(1000, 1400, scene.nodes), null);

  // Test 2: Ellipse shape hit testing
  // Center of ellipse1 is (300 + 100, 200 + 100) = (400, 300), radii rx=100, ry=100
  // Center is definitely inside ellipse
  const ellipseNode = scene.nodes.find((n) => n.id === 'ellipse1')!;
  assert.equal(isPointInNode(400, 300, ellipseNode), true);
  // Corner of ellipse bounding box (305, 205): local (5, 5). Distance from (100, 100) is (95^2 + 95^2) / 100^2 = 1.8 > 1 => OUTSIDE!
  assert.equal(isPointInNode(305, 205, ellipseNode), false);

  // Test 3: Rect shape hit testing
  const rectNode = scene.nodes.find((n) => n.id === 'rect1')!;
  assert.equal(isPointInNode(150, 150, rectNode), true);
  assert.equal(isPointInNode(50, 50, rectNode), false);
  assert.equal(isPointInNode(450, 350, rectNode), false);

  // Test 4: Z-order resolution
  // At (200, 180), both rect1 (index 0) and text1 (index 2) overlap.
  // Hit testing MUST return topmost node (text1, the later index)!
  const hitOverlap = hitTest(200, 180, scene.nodes);
  assert.ok(hitOverlap);
  assert.equal(hitOverlap.id, 'text1');

  // At (120, 120), only rect1 is present
  const hitRect = hitTest(120, 120, scene.nodes);
  assert.ok(hitRect);
  assert.equal(hitRect.id, 'rect1');
});

test('hit-testing with rotation: local coordinate transformation agrees with rotated geometry', () => {
  const rotatedRect: SceneNode = {
    id: 'rot1',
    type: 'rect',
    x: 200,
    y: 200,
    width: 100,
    height: 100,
    rotation: 45,
    opacity: 1,
    fill: '#ff0000',
    cornerRadius: 0,
  };

  // Center of local rect is (50, 50)
  // At 45 deg, local (50, 50) in canvas coords is:
  // x = 200 + 50*cos(45) - 50*sin(45) = 200 + 0 = 200
  // y = 200 + 50*sin(45) + 50*cos(45) = 200 + 50*sqrt(2) ≈ 270.71
  const centerCanvas = toCanvasPoint(50, 50, rotatedRect);
  assert.equal(isPointInNode(centerCanvas.x, centerCanvas.y, rotatedRect), true);

  // Point (200, 200) is the rotation origin (local 0, 0), so it is inside
  assert.equal(isPointInNode(200, 200, rotatedRect), true);

  // Point (280, 200): in unrotated space this would be inside (x=280 is between 200 and 300),
  // but rotated 45 degrees it falls OUTSIDE the diamond!
  const local = toLocalPoint(280, 200, rotatedRect);
  // dx = 80, dy = 0 => lx = 80*cos(45) ≈ 56.57, ly = -80*sin(45) ≈ -56.57 (< 0 => outside!)
  assert.ok(local.y < 0);
  assert.equal(isPointInNode(280, 200, rotatedRect), false);
});

test('drag mapping: translation clamped within canvas boundaries', () => {
  const node: SceneNode = {
    id: 'box',
    type: 'rect',
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
    fill: '#000',
    cornerRadius: 0,
  };

  // Normal drag
  const d1 = dragNode(node, 50, 30);
  assert.deepEqual(d1, { x: 150, y: 130 });

  // Drag exceeding right/bottom boundary (1080 - 300 = 780, 1440 - 200 = 1240)
  const dMax = dragNode(node, 1000, 1500);
  assert.deepEqual(dMax, { x: 780, y: 1240 });

  // Drag exceeding left/top boundary
  const dMin = dragNode(node, -500, -500);
  assert.deepEqual(dMin, { x: 0, y: 0 });
});

test('rotated-box resize: handles anchor correctly and reflows text at constant font size', () => {
  const textNode: SceneNode = {
    id: 'text',
    type: 'text',
    x: 100,
    y: 100,
    width: 400,
    height: 150,
    rotation: 0,
    opacity: 1,
    text: 'Constant font size during resize reflow',
    font: 'sans',
    fontSize: 48,
    fontWeight: 'normal',
    lineHeight: 1.3,
    align: 'left',
    wrap: 'word',
    fill: '#000000',
  };

  // Resize via bottom-right ('se') handle: expands width and height
  const se = resizeRotatedBox('se', textNode, 600, 350);
  assert.equal(se.x, 100);
  assert.equal(se.y, 100);
  assert.equal(se.width, 500);
  assert.equal(se.height, 250);
  // Constant font size: fontSize is NOT modified
  assert.equal(textNode.fontSize, 48);

  // Resize via top-left ('nw') handle: anchor at BR (500, 250) remains fixed
  const nw = resizeRotatedBox('nw', textNode, 50, 50);
  assert.equal(nw.x, 50);
  assert.equal(nw.y, 50);
  assert.equal(nw.width, 450);
  assert.equal(nw.height, 200);

  // Resize via right ('e') handle: changes width only
  const eHandle = resizeRotatedBox('e', textNode, 700, 100);
  assert.equal(eHandle.x, 100);
  assert.equal(eHandle.y, 100);
  assert.equal(eHandle.width, 600);
  assert.equal(eHandle.height, 150);

  // Clamping: guarantees parseScene validity even if dragged outside canvas
  const over = resizeRotatedBox('se', textNode, 2000, 3000);
  assert.ok(over.x + over.width <= 1080);
  assert.ok(over.y + over.height <= 1440);
  assert.ok(over.width >= 1);
  assert.ok(over.height >= 1);
});

test('rect cornerRadius clamping: cornerRadius cannot exceed min(width, height) / 2', () => {
  const rectNode: SceneNode = {
    id: 'r',
    type: 'rect',
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    fill: '#fff',
    cornerRadius: 80,
  };

  // Resize width down to 60px. Max cornerRadius allowed is 60 / 2 = 30px!
  const shrunk = resizeRotatedBox('e', rectNode, 160, 100);
  assert.equal(shrunk.width, 60);
  assert.equal(shrunk.cornerRadius, 30);
});

test('center alignment: Center X and Center Y calculate exact canvas center coordinates', () => {
  const node: SceneNode = {
    id: 'center-test',
    type: 'rect',
    x: 10,
    y: 10,
    width: 400,
    height: 300,
    rotation: 0,
    opacity: 1,
    fill: '#000',
    cornerRadius: 0,
  };

  // Canvas is 1080 x 1440
  // Center X: (1080 - 400) / 2 = 340
  const cx = centerNode(node, 'x');
  assert.equal(cx.x, 340);

  // Center Y: (1440 - 300) / 2 = 570
  const cy = centerNode(node, 'y');
  assert.equal(cy.y, 570);
});

test('rotation calculation: rotateBox returns angle in [-180, 180]', () => {
  const node: SceneNode = {
    id: 'rot-test',
    type: 'rect',
    x: 400,
    y: 600,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    fill: '#000',
    cornerRadius: 0,
  };

  // Center is (500, 700). Pointer directly above center at (500, 500) -> 0 degrees
  const angleUp = rotateBox(node, 500, 500);
  assert.equal(angleUp, 0);

  // Pointer directly right of center at (700, 700) -> 90 degrees
  const angleRight = rotateBox(node, 700, 700);
  assert.equal(angleRight, 90);

  // Pointer directly left of center at (300, 700) -> -90 degrees
  const angleLeft = rotateBox(node, 300, 700);
  assert.equal(angleLeft, -90);
});

test('gesture undo and fencing: unique gesture ID creates one undo step and cancels safely', async () => {
  const c = new VisualRemixController(async (s) => rendered(s));
  const assets = new LocalAssets();
  const scene = testScene();
  await c.open('gesture-test', 0, scene, assets);

  // 1. Staging a gesture fences export immediately
  const gestureId = 'drag-title-gesture';
  const ticket = c.stageLocalEdit(gestureId);
  assert.equal(c.snapshot().editing, true);
  assert.throws(() => c.exportPNG(), /LOCAL_EDIT_PENDING/);

  // 2. Commit the gesture
  const movedScene = structuredClone(scene);
  movedScene.nodes[0].x = 250;
  movedScene.nodes[0].y = 220;
  const result = await c.renderLocalEdit(movedScene, ticket);
  assert.equal(result, 'applied');
  assert.equal(c.snapshot().editing, false);
  assert.equal(c.snapshot().revision, 1);
  assert.equal(c.snapshot().scene?.nodes[0].x, 250);

  // 3. Staging and cancelling a second gesture retains the last valid Scene
  const canceledGesture = 'cancel-gesture';
  const cancelTicket = c.stageLocalEdit(canceledGesture);
  assert.equal(c.snapshot().editing, true);
  c.discardLocalEdit();
  assert.equal(c.snapshot().editing, false);
  assert.equal(c.snapshot().scene?.nodes[0].x, 250);

  // 4. One Undo restores the original Scene prior to the gesture
  assert.equal(c.undo(), true);
  assert.equal(c.snapshot().scene?.nodes[0].x, 100);
  assert.equal(c.undo(), false, 'only one undo step for the completed gesture');

  c.dispose();
});

 test('resize across the opposite anchor preserves that anchor at minimum size',()=>{
 const n:SceneNode={id:'r',type:'rect',x:100,y:100,width:400,height:200,rotation:0,opacity:1,fill:'#112233',cornerRadius:0};
 const b=resizeRotatedBox('nw',n,600,400);assert.equal(b.width,1);assert.equal(b.height,1);assert.equal(b.x+b.width,500);assert.equal(b.y+b.height,300);
 const r={...n,rotation:30};const anchor=toCanvasPoint(r.width,r.height,r);const pointer=toCanvasPoint(600,400,r);const resized={...r,...resizeRotatedBox('nw',r,pointer.x,pointer.y)};const after=toCanvasPoint(resized.width,resized.height,resized);assert.ok(Math.abs(anchor.x-after.x)<0.11);assert.ok(Math.abs(anchor.y-after.y)<0.11);
 });
