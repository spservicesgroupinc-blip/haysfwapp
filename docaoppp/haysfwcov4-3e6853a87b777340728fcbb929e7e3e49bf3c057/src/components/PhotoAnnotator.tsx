import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Check,
  Circle as CircleIcon,
  Eraser,
  PenLine,
  Redo2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import "./PhotoAnnotator.css";

export interface PhotoAnnotatorProps {
  /** The photo the project manager chose from the phone camera or library. */
  file: File;
  /** Called with the flattened, annotated JPEG once the user taps Save. */
  onSave: (annotated: Blob) => void;
  /** Called when the user backs out without saving. */
  onCancel: () => void;
}

type Tool = "pen" | "arrow" | "text" | "circle";

/**
 * Annotation shapes are stored as a vector list and always measured in the
 * photo's NATURAL pixel space. Keeping one coordinate system means the screen
 * composite and the exported full-resolution JPEG are the same drawing at two
 * scales: the canvas transform scales natural -> CSS pixels on screen, and the
 * export draws them unscaled.
 */
interface ShapeBase {
  id: string;
  color: string;
  /** Stroke width in natural image pixels (so it exports at the right weight). */
  width: number;
}

interface PenShape extends ShapeBase {
  kind: "pen";
  points: Pt[];
}

interface ArrowShape extends ShapeBase {
  kind: "arrow";
  from: Pt;
  to: Pt;
}

interface TextShape extends ShapeBase {
  kind: "text";
  at: Pt;
  /** May contain "\n"; every line is rendered. */
  text: string;
}

interface CircleShape extends ShapeBase {
  kind: "circle";
  /** Two opposite corners of the ellipse's bounding box. */
  from: Pt;
  to: Pt;
}

type Shape = PenShape | ArrowShape | TextShape | CircleShape;

interface Pt {
  x: number;
  y: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Present only when createImageBitmap produced the source; must be closed. */
  bitmap: ImageBitmap | null;
}

/** Everything the pointer -> natural-coordinate mapping needs for one frame. */
interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** CSS pixel size of the canvas; used to ignore stale ResizeObserver frames. */
  cssWidth: number;
  cssHeight: number;
}

interface PendingText {
  at: Pt;
}

/** These two are the only browser APIs this file has to widen by hand. */
interface ImageBitmapSourceOptions {
  imageOrientation?: string;
}

const TOOLS: { value: Tool; label: string; Icon: typeof PenLine }[] = [
  { value: "pen", label: "Pen", Icon: PenLine },
  { value: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { value: "text", label: "Text", Icon: Type },
  { value: "circle", label: "Circle", Icon: CircleIcon },
];

const COLORS: { value: string; label: string }[] = [
  { value: "#dc2626", label: "Red" },
  { value: "#facc15", label: "Yellow" },
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
  { value: "#2563eb", label: "Blue" },
];

/**
 * Stroke-width presets in CSS pixels at 100% zoom. The chosen preset is divided
 * by the current view scale when a stroke starts, which turns it into natural
 * pixels: a "medium" line looks the same weight on a small phone preview and in
 * the exported full-resolution JPEG.
 */
const WIDTH_PRESETS: { value: number; label: string }[] = [
  { value: 4, label: "Thin" },
  { value: 9, label: "Medium" },
  { value: 18, label: "Thick" },
];

const FONT_STACK =
  '"Helvetica Neue", Helvetica, Arial, ui-sans-serif, system-ui, sans-serif';

let shapeSeq = 0;
function nextShapeId(): string {
  shapeSeq += 1;
  return `shape-${shapeSeq}`;
}

/** Relative luminance, so a yellow/white label gets dark text on top of it. */
function isLightColor(color: string): boolean {
  const normalized = color.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  return lines.length > 0 ? lines : [""];
}

/** Longest line width in natural pixels (the multi-line label box width). */
function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
): { width: number; lineHeight: number } {
  ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
  const lines = linesOf(text);
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width);
  }
  return { width, lineHeight: fontPx * 1.25 };
}

/**
 * Decodes the photo with the browser's own EXIF handling. createImageBitmap with
 * imageOrientation "from-image" bakes the rotation in, so a phone photo shot in
 * portrait never comes out sideways. Older engines reject that option, so we
 * degrade to a plain createImageBitmap and finally to an <img> (whose default
 * `image-orientation: from-image` CSS applies the EXIF rotation for us).
 */
async function loadImage(
  file: File,
  urlHolder: { current: string | null },
): Promise<DecodedImage> {
  const bitmapOptions: ImageBitmapSourceOptions = {
    imageOrientation: "from-image",
  };
  // SAFETY: `imageOrientation` is a real ImageBitmapOptions member (Chrome 79+,
  // Safari 15+) but is missing from the lib.dom typings bundled here.
  const bitmapOptionsForDom = bitmapOptions as ImageBitmapOptions;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, bitmapOptionsForDom);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
      };
    } catch {
      // Fall through to the <img> path below.
    }
  }
  const url = URL.createObjectURL(file);
  urlHolder.current = url;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("decode failed"));
    element.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    bitmap: null,
  };
}

function drawPen(ctx: CanvasRenderingContext2D, shape: PenShape) {
  const points = shape.points;
  if (points.length === 0) return;
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (points.length === 1) {
    // A tap with the pen still leaves a dot: stroke a zero-length segment.
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[0].x + 0.01, points[0].y);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // Sample midpoints as quadratic control points: a cheap smoothing pass that
  // removes the polygonal look of raw pointer samples, then redraw as a path.
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Straight shaft plus a filled triangular head. The head is sized from the
 * stroke width but never longer than 40% of the shaft, so short arrows keep a
 * visible head instead of collapsing into a blob.
 */
function drawArrow(ctx: CanvasRenderingContext2D, shape: ArrowShape) {
  const dx = shape.to.x - shape.from.x;
  const dy = shape.to.y - shape.from.y;
  const length = Math.hypot(dx, dy);
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  if (length < 0.5) return;
  const head = Math.min(Math.max(shape.width * 3, 10), length * 0.4);
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7; // ~26 degrees off the shaft, each side.
  const baseX = shape.to.x - Math.cos(angle) * head;
  const baseY = shape.to.y - Math.sin(angle) * head;
  ctx.beginPath();
  ctx.moveTo(shape.from.x, shape.from.y);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shape.to.x, shape.to.y);
  ctx.lineTo(
    baseX + Math.cos(angle - spread) * head * 0.42,
    baseY + Math.sin(angle - spread) * head * 0.42,
  );
  ctx.lineTo(
    baseX + Math.cos(angle + spread) * head * 0.42,
    baseY + Math.sin(angle + spread) * head * 0.42,
  );
  ctx.closePath();
  ctx.fill();
}

function drawCircle(ctx: CanvasRenderingContext2D, shape: CircleShape) {
  // The two gesture points are opposite corners of the ellipse's box, so a
  // mostly-vertical drag already reads as a tall highlight.
  const centerX = (shape.from.x + shape.to.x) / 2;
  const centerY = (shape.from.y + shape.to.y) / 2;
  const radiusX = Math.abs(shape.to.x - shape.from.x) / 2;
  const radiusY = Math.abs(shape.to.y - shape.from.y) / 2;
  if (radiusX < 0.5 && radiusY < 0.5) return;
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.ellipse(
    centerX,
    centerY,
    Math.max(radiusX, 0.5),
    Math.max(radiusY, 0.5),
    0, // no rotation: the box corners come straight from a screen-space drag
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  shape: TextShape,
  options: { preview: boolean },
) {
  const fontPx = Math.max(16, shape.width * 5);
  const { lineHeight } = measureText(ctx, shape.text, fontPx);
  const lines = linesOf(shape.text);
  ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.globalAlpha = options.preview ? 0.85 : 1;
  ctx.fillStyle = shape.color;
  ctx.strokeStyle = isLightColor(shape.color) ? "#000000cc" : "#ffffffb3";
  ctx.lineWidth = Math.max(2, fontPx * 0.14);
  ctx.lineJoin = "round";
  lines.forEach((line, index) => {
    const y = shape.at.y + index * lineHeight;
    ctx.strokeText(line, shape.at.x, y);
    ctx.fillText(line, shape.at.x, y);
  });
  ctx.globalAlpha = 1;
}

/** Paints one shape. `preview` marks the in-progress / uncommitted variant. */
function paintShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  preview: boolean,
) {
  switch (shape.kind) {
    case "pen":
      drawPen(ctx, shape);
      break;
    case "arrow":
      drawArrow(ctx, shape);
      break;
    case "circle":
      drawCircle(ctx, shape);
      break;
    case "text":
      drawText(ctx, shape, { preview });
      break;
  }
}

export default function PhotoAnnotator(
  props: PhotoAnnotatorProps,
): React.ReactElement {
  const { file, onSave, onCancel } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const viewRef = useRef<View>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    cssWidth: 0,
    cssHeight: 0,
  });
  /** Cleared on unmount so a late decode can never set state after teardown. */
  const mountedRef = useRef(true);

  const [image, setImage] = useState<DecodedImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#dc2626");
  const [widthPreset, setWidthPreset] = useState(9);
  // History is an array of whole shape lists plus a cursor: undo/redo is an
  // index move and every redraw is a pure function of (image, visible shapes).
  const [history, setHistory] = useState<Shape[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [activeShape, setActiveShape] = useState<Shape | null>(null);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [textValue, setTextValue] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const visibleShapes: Shape[] = activeShape
    ? [...history[historyIndex], activeShape]
    : history[historyIndex];
  shapesRef.current = visibleShapes;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Decode the file once per File. The object URL (only used by the fallback
  // path) is revoked by this effect's teardown, which fires on unmount.
  useEffect(() => {
    let cancelled = false;
    const urlHolder: { current: string | null } = { current: null };
    setImage(null);
    setLoadError(null);
    setHistory([[]]);
    setHistoryIndex(0);
    setActiveShape(null);
    setPendingText(null);
    setTextValue("");
    setErrorMessage(null);
    loadImage(file, urlHolder)
      .then((decoded) => {
        if (cancelled) {
          decoded.bitmap?.close();
          return;
        }
        setImage(decoded);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            "This photo could not be opened. Go back and pick another one.",
          );
        }
      });
    return () => {
      cancelled = true;
      if (urlHolder.current) URL.revokeObjectURL(urlHolder.current);
    };
  }, [file]);

  // Release the bitmap (a GPU/CPU-backed image) when the image changes.
  useEffect(() => {
    if (!image) return;
    const bitmap = image.bitmap;
    return () => {
      bitmap?.close();
    };
  }, [image]);

  // Measure the stage so the canvas can be sized to the viewport (contain).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      setBox((previous) => {
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        return previous.width === width && previous.height === height
          ? previous
          : { width, height };
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Redraw is derived state, so it happens in an effect: image or shapes or the
  // measured box change -> repaint. No pixel snapshots are ever stored.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const cssWidth = Math.max(1, box.width);
    const cssHeight = Math.max(1, box.height);
    const dpr = window.devicePixelRatio || 1;
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bufferWidth, bufferHeight);

    // "Contain" fit inside the CSS box (updated eagerly so pointer maths is
    // never a frame behind), then letterbox it in the middle.
    const scale = Math.min(cssWidth / image.width, cssHeight / image.height);
    const offsetX = (cssWidth - image.width * scale) / 2;
    const offsetY = (cssHeight - image.height * scale) / 2;
    viewRef.current = { scale, offsetX, offsetY, cssWidth, cssHeight };

    // From here on the context works in NATURAL image pixels: devicePixelRatio
    // first for crispness on retina screens, then the contain scale + offset.
    ctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, offsetY * dpr);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(image.source, 0, 0, image.width, image.height);
    const shapes = shapesRef.current;
    for (let i = 0; i < shapes.length; i += 1) {
      paintShape(ctx, shapes[i], false);
    }
    if (pendingText && textValue.trim().length > 0) {
      // Live text preview: same geometry and colours as the committed label,
      // drawn at 85% alpha so it reads as not-yet-placed.
      drawText(
        ctx,
        {
          id: "pending",
          kind: "text",
          at: pendingText.at,
          text: textValue,
          color,
          // The stored width is in natural pixels; mirror what commit will use.
          width: widthPreset / Math.max(scale, 0.0001),
        },
        { preview: true },
      );
    }
    ctx.restore();
  }, [image, box, visibleShapes, pendingText, textValue, color, widthPreset]);

  // Focus the label field as soon as the user taps the photo with the text tool.
  useEffect(() => {
    if (pendingText && textInputRef.current) textInputRef.current.focus();
  }, [pendingText]);

  // Clear confirmation takes focus, so a stray tap on Enter lands on "Keep them".
  useEffect(() => {
    if (clearOpen) confirmCancelRef.current?.focus();
  }, [clearOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (clearOpen) {
        setClearOpen(false);
        return;
      }
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearOpen, onCancel]);

  /** Screen point -> natural image pixels (the inverse of the draw transform). */
  const toNatural = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      // CSS pixels between the canvas edge and the pointer, minus the letterbox,
      // divided by the contain scale.
      const x = (event.clientX - rect.left - view.offsetX) / view.scale;
      const y = (event.clientY - rect.top - view.offsetY) / view.scale;
      return { x, y };
    },
    [],
  );

  /** Commits a finished shape to history, dropping any redo tail. */
  const commitShape = useCallback(
    (shape: Shape) => {
      setHistory((previous) => {
        const next = previous.slice(0, historyIndex + 1);
        next.push([...previous[historyIndex], shape]);
        return next;
      });
      setHistoryIndex((index) => index + 1);
      setActiveShape(null);
      setErrorMessage(null);
    },
    [historyIndex],
  );

  const startShape = useCallback(
    (point: Pt): Shape => {
      // Natural-pixel width: a "medium" stroke keeps the same apparent weight
      // whatever the photo resolution is.
      const width = widthPreset / Math.max(viewRef.current.scale, 0.0001);
      const id = nextShapeId();
      if (tool === "pen") {
        return { id, kind: "pen", color, width, points: [point] };
      }
      if (tool === "arrow") {
        return { id, kind: "arrow", color, width, from: point, to: point };
      }
      return { id, kind: "circle", color, width, from: point, to: point };
    },
    [color, tool, widthPreset],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (activePointerRef.current !== null) return; // single active pointer only
    const canvas = canvasRef.current;
    if (!canvas || !image || exporting || saved) return;
    event.preventDefault();
    if (tool === "text") {
      setPendingText({ at: toNatural(event) });
      return;
    }
    activePointerRef.current = event.pointerId;
    // Capture keeps the gesture alive when the finger slides off the canvas.
    canvas.setPointerCapture(event.pointerId);
    setActiveShape(startShape(toNatural(event)));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = toNatural(event);
    setActiveShape((shape) => {
      if (!shape) return shape;
      if (shape.kind === "pen") {
        const previous = shape.points[shape.points.length - 1];
        // Drop sub-pixel jitter: fewer points, same visual line.
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.75) {
          return shape;
        }
        return { ...shape, points: [...shape.points, point] };
      }
      if (shape.kind === "circle" || shape.kind === "arrow") {
        return { ...shape, to: point };
      }
      return shape;
    });
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    const shape = activeShape;
    setActiveShape(null);
    if (!shape) return;
    if (shape.kind === "arrow" || shape.kind === "circle") {
      const dx = shape.to.x - shape.from.x;
      const dy = shape.to.y - shape.from.y;
      // Ignore accidental taps that would leave an invisible zero-size shape.
      if (Math.hypot(dx, dy) < 3 / Math.max(viewRef.current.scale, 0.0001)) {
        return;
      }
    }
    commitShape(shape);
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    setActiveShape(null);
  };

  const handleColor = (value: string) => {
    setColor(value);
    if (pendingText) setPendingText({ ...pendingText });
  };

  const commitText = () => {
    if (!pendingText) return;
    const value = textValue.replace(/\s+$/, "");
    if (value.length === 0) return;
    const width = widthPreset / Math.max(viewRef.current.scale, 0.0001);
    commitShape({
      id: nextShapeId(),
      kind: "text",
      at: pendingText.at,
      text: value,
      color,
      width,
    });
    setPendingText(null);
    setTextValue("");
  };

  const clearPendingText = () => {
    setPendingText(null);
    setTextValue("");
  };

  const undo = () => {
    setPendingText(null);
    setTextValue("");
    setHistoryIndex((index) => Math.max(0, index - 1));
  };

  const redo = () => {
    setPendingText(null);
    setTextValue("");
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
  };

  const confirmClear = () => {
    setActiveShape(null);
    setPendingText(null);
    setTextValue("");
    // Clearing is itself a history entry, so it can be undone.
    setHistory((previous) => [...previous.slice(0, historyIndex + 1), []]);
    setHistoryIndex((index) => index + 1);
    setClearOpen(false);
  };

  const handleSave = () => {
    if (!image) {
      setErrorMessage(
        "The photo is still loading. Try Save again in a moment.",
      );
      return;
    }
    if (exporting || saved) return;
    setExporting(true);
    setErrorMessage(null);
    try {
      // New offscreen canvas at the photo's own pixel size. Shapes are already
      // in natural coordinates, so nothing has to be rescaled here.
      const output = document.createElement("canvas");
      output.width = image.width;
      output.height = image.height;
      const ctx = output.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(image.source, 0, 0, image.width, image.height);
      const shapes = shapesRef.current;
      for (let i = 0; i < shapes.length; i += 1) {
        paintShape(ctx, shapes[i], false);
      }
      output.toBlob(
        (blob) => {
          if (!mountedRef.current) return;
          if (!blob) {
            setExporting(false);
            setErrorMessage(
              "The annotated photo could not be saved. Try again.",
            );
            return;
          }
          setSaved(true);
          setExporting(false);
          onSave(blob);
        },
        "image/jpeg",
        0.92,
      );
    } catch {
      setExporting(false);
      setErrorMessage("The annotated photo could not be saved. Try again.");
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const strokeCount = history[historyIndex].length;

  return (
    <div
      className="photo-annotator"
      role="dialog"
      aria-modal="true"
      aria-label="Annotate photo"
    >
      <header className="photo-annotator-head">
        <button
          type="button"
          className="photo-annotator-head-button"
          onClick={onCancel}
          aria-label="Cancel and discard annotations"
        >
          <X size={22} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <div className="photo-annotator-title">
          <strong>Annotate photo</strong>
          <small>{file.name}</small>
        </div>
        <button
          type="button"
          className="photo-annotator-head-button photo-annotator-save"
          onClick={handleSave}
          disabled={exporting || saved}
          aria-label="Save annotated photo"
        >
          {saved ? (
            <Check size={22} aria-hidden="true" />
          ) : (
            <span className="photo-annotator-save-dot" aria-hidden="true" />
          )}
          <span>{exporting ? "Saving…" : saved ? "Saved" : "Save"}</span>
        </button>
      </header>

      {errorMessage || loadError ? (
        <p className="photo-annotator-error" role="alert">
          {errorMessage ?? loadError}
        </p>
      ) : null}

      <div className="photo-annotator-stage" ref={stageRef}>
        <div className="photo-annotator-frame">
          <canvas
            ref={canvasRef}
            className="photo-annotator-canvas"
            style={{ width: box.width, height: box.height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={handlePointerCancel}
            aria-label="Photo with annotations. Draw with a finger or a mouse."
          />
        </div>
        {!image && !loadError ? (
          <p className="photo-annotator-loading" role="status">
            Loading photo…
          </p>
        ) : null}
      </div>

      <div className="photo-annotator-controls">
        {tool === "text" ? (
          <div className="photo-annotator-text-row">
            <input
              ref={textInputRef}
              className="photo-annotator-text-input"
              type="text"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitText();
                }
              }}
              placeholder={
                pendingText ? "Type the label" : "Tap the photo, then type"
              }
              aria-label="Label text"
            />
            <button
              type="button"
              className="photo-annotator-commit"
              onClick={commitText}
              disabled={!pendingText || textValue.trim().length === 0}
              aria-label="Place label on the photo"
            >
              <Check size={20} aria-hidden="true" />
              <span>Place</span>
            </button>
            <button
              type="button"
              className="photo-annotator-cancel-text"
              onClick={clearPendingText}
              disabled={!pendingText && textValue.length === 0}
              aria-label="Discard this label"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="photo-annotator-toolbar">
          <div
            className="photo-annotator-group"
            role="group"
            aria-label="Annotation tools"
          >
            {TOOLS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className="pa-tool"
                aria-label={`${label} tool`}
                aria-pressed={tool === value}
                onClick={() => {
                  setTool(value);
                  if (value !== "text") clearPendingText();
                }}
              >
                <Icon size={22} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div
            className="photo-annotator-group"
            role="group"
            aria-label="Annotation colour"
          >
            {COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="pa-color"
                style={{ backgroundColor: option.value }}
                aria-label={`${option.label} colour`}
                aria-pressed={color === option.value}
                onClick={() => handleColor(option.value)}
              />
            ))}
          </div>

          <div
            className="photo-annotator-group"
            role="group"
            aria-label="Stroke width"
          >
            {WIDTH_PRESETS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="pa-width"
                aria-label={`${option.label} stroke`}
                aria-pressed={widthPreset === option.value}
                onClick={() => setWidthPreset(option.value)}
              >
                <span
                  className="pa-width-bar"
                  style={{ height: option.value }}
                  aria-hidden="true"
                />
                <span>{option.label}</span>
              </button>
            ))}
          </div>

          <div
            className="photo-annotator-group"
            role="group"
            aria-label="Annotation history"
          >
            <button
              type="button"
              className="pa-tool"
              aria-label="Undo last annotation"
              aria-pressed={false}
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 size={22} aria-hidden="true" />
              <span>Undo</span>
            </button>
            <button
              type="button"
              className="pa-tool"
              aria-label="Redo annotation"
              aria-pressed={false}
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 size={22} aria-hidden="true" />
              <span>Redo</span>
            </button>
            <button
              type="button"
              className="pa-tool"
              aria-label="Clear all annotations"
              aria-pressed={false}
              disabled={strokeCount === 0 && !activeShape}
              onClick={() => setClearOpen(true)}
            >
              <Eraser size={22} aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      </div>

      {clearOpen ? (
        <div className="photo-annotator-confirm">
          <div
            className="photo-annotator-confirm-box"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="photo-annotator-confirm-title"
          >
            <h2 id="photo-annotator-confirm-title">Clear annotations?</h2>
            <p>
              All marks on this photo are removed. You can undo this straight
              after.
            </p>
            <div className="photo-annotator-confirm-actions">
              <button
                type="button"
                className="photo-annotator-confirm-cancel"
                ref={confirmCancelRef}
                onClick={() => setClearOpen(false)}
              >
                Keep them
              </button>
              <button
                type="button"
                className="photo-annotator-confirm-clear"
                onClick={confirmClear}
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
