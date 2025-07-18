const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
canvas.addEventListener('contextmenu', e => e.preventDefault());

const clearBtn = document.getElementById('clearBtn');
const sizeDisplay = document.getElementById('sizeDisplay');

// change localstorage key and migrate any stored data
const OLD_STORAGE_KEY = 'drawingAppState';
const NEW_STORAGE_KEY = 'fancydoodleAppState';

function migrateStorage() {
  if (localStorage.getItem(OLD_STORAGE_KEY) && !localStorage.getItem(NEW_STORAGE_KEY)) {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    localStorage.setItem(NEW_STORAGE_KEY, oldData);
    localStorage.removeItem(OLD_STORAGE_KEY);
    // console.log('Storage migrated from old key to new key.');
  }
}
migrateStorage();

let STORAGE_KEY = NEW_STORAGE_KEY;

// State
let actions = [];
let mode = 'draw';
let isTyping = false;
let activeText = null;

let redoStack = [];

let cursorVisible = false;
let cursorTimer = null;
let typingTimer = null;

let fontSize = 16;
let brushSize = 2;
let currentStrokeColor = "#000000";

let isDrawing = false;
let isStraightLine = false;

let isDrawingCircle = false;
let circleStartPoint = null;
let currentCircle = null;

let isDraggingText = false;
let draggingTextIndex = -1;
let dragOffsetX = 0, dragOffsetY = 0;
let dragStartX = 0, dragStartY = 0;
const dragThreshold = 5; // pixels to move before considered dragging

const lineHeight = 20;
const cursorLineWeight = 4;
const cursorBlinkLife = 1000000;

// Storage helpers
function saveToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    actions, fontSize, brushSize, currentStrokeColor, mode
  }));
}

function loadFromLocalStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const state = JSON.parse(saved);
    actions = state.actions || [];
    fontSize = state.fontSize || 16;
    brushSize = state.brushSize || 2;
    currentStrokeColor = state.currentStrokeColor || "#000000";
    mode = state.mode || 'draw';
  } catch (e) {
    console.warn("Error loading saved state", e);
  }
}

// Helper: Text font
function setTextContextFont(size = fontSize) {
  ctx.font = `${size}px Spraypaint`;
  ctx.textBaseline = 'top';
}

// Helper: Text bounding box
function getTextBoundingBox(t) {
  setTextContextFont(t.fontSize);
  const lines = t.text.split('\n');
  const width = Math.max(...lines.map(line => ctx.measureText(line).width));
  const height = lines.length * lineHeight;
  return { width, height };
}

// Commit text input to actions array
function commitTextInput() {
  if (!activeText || !activeText.text.trim()) return;

  const idx = actions.findIndex(a => a === activeText._action);
  if (idx !== -1) {
    actions[idx] = {
      type: 'text',
      data: {
        ...activeText,
        color: currentStrokeColor,
        fontSize,
        rotation: activeText.rotation || 0
      }
    };
  } else {
    actions.push({
      type: 'text',
      data: {
        ...activeText,
        color: currentStrokeColor,
        fontSize
      }
    });

    redoStack = []; // Clear redo history on new action
  }

  activeText = null;
  isTyping = false;
  clearInterval(cursorTimer);
  clearTimeout(typingTimer);
  cursorVisible = false;
  saveToLocalStorage();
  draw();
}

// Text editing init
function startTyping(x, y, existingAction = null, cursorPos = null) {
  isTyping = true;
  activeText = existingAction
  ? { 
      ...existingAction.data, 
      fontSize: existingAction.data.fontSize || fontSize, 
      cursorPos: cursorPos !== null ? cursorPos : existingAction.data.text.length,
      rotation: existingAction.data.rotation || 0,
      _action: existingAction 
    }
  : { 
      text: '', 
      x, 
      y, 
      fontSize, 
      color: currentStrokeColor,
      rotation: 0,
      cursorPos: 0 
    };

  clearInterval(cursorTimer);
  cursorTimer = setInterval(toggleCursor, 500);
  resetTypingTimer();
  draw();
}


// Typing timer
function resetTypingTimer() {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(finishTyping, cursorBlinkLife);
}

// Typing done
function finishTyping() {
  if (isTyping) commitTextInput();
}

// Toggle cursor blink
function toggleCursor() {
  cursorVisible = !cursorVisible;
  draw();
}

// Stop typing explicitly
function stopTyping() {
  if (isTyping) {
    commitTextInput();
  }
  activeText = null;
  isTyping = false;
  clearInterval(cursorTimer);
  clearTimeout(typingTimer);
  cursorVisible = false;
  draw();
}

// Size display + update
function updateSizeDisplay() {
  const label = mode === 'text' ? 'Text' : 'Draw';
  const size = mode === 'text' ? fontSize : brushSize;
  sizeDisplay.textContent = `${label} Mode - ${size}px`;
  document.body.style.backgroundColor = mode === 'text' ? '#7c3aed' : '#ffffff';
}

// Resizing
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}
window.addEventListener('resize', () => setTimeout(() => location.reload(), 1000));
resizeCanvas();

// Init
loadFromLocalStorage();
updateSizeDisplay();
document.fonts.ready.then(() => {
  setTextContextFont();
  draw();
});

// Event: Clear
clearBtn.addEventListener('click', () => {
  if (confirm("Are you sure?")) {
    actions = [];
    stopTyping();
    isDrawing = false;
    mode = 'draw';
    updateSizeDisplay();
    saveToLocalStorage();
    draw();
  }
});

















// Event: KeyDown
document.addEventListener('keydown', e => {
  const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
  const isRedo = (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));

  // First, intercept undo/redo regardless of typing state
  if (isUndo) {
    e.preventDefault();
    undoLastAction();
    return;
  }

  if (isRedo) {
    e.preventDefault();
    redoLastAction();
    return;
  }

  // Ctrl+[ or Ctrl+]
  if (isTyping && activeText && e.ctrlKey) {
    if (e.code === 'BracketLeft') {
      e.preventDefault();
      activeText.rotation = (activeText.rotation || 0) - 5;
      draw();
      return;
    } else if (e.code === 'BracketRight') {
      e.preventDefault();
      activeText.rotation = (activeText.rotation || 0) + 5;
      draw();
      return;
    }
  }

  // Cmd/Ctrl + +/- to adjust font or brush size
  if ((e.metaKey || e.ctrlKey) && 
      (e.key === '+' || e.key === '=' || e.key === 'NumpadAdd' || 
       e.key === '-' || e.key === '_' || e.key === 'NumpadSubtract')) {
    
    e.preventDefault(); // prevent zoom or character insertion

    const delta = (e.key === '+' || e.key === '=' || e.key === 'NumpadAdd') ? 1 : -1;
    adjustSize(mode, delta);

    if (mode === 'text' && isTyping && activeText) {
      activeText.fontSize = fontSize; // <-- ensure activeText reflects new size
      draw(); // live update with correct font size
    }

    return;
  }

  // Escape: cancel typing or drawing
  if (e.key === 'Escape') {
    stopTyping();
    isDrawing = false;
    mode = 'draw';

    setActiveColor(blackBtn, "#000000", 2);
    
    updateSizeDisplay();
    draw();
    return;
  }

  // T: enter text mode
  if (!isTyping && e.key.toLowerCase() === 't') {
    mode = 'text';
    fontSize = 16; // Optional: reset to default text size

    // Simulate clicking blackBtn to ensure color and active state
    setActiveColor(blackBtn, "#000000", brushSize); 

    updateSizeDisplay();
    draw();
    return;
  }


// Preset color shortcuts (only in draw mode and not typing)
// add guard clause to ignore modifier keys to avoid conflict with redo cmd + Y
if (!isTyping && mode === 'draw' && !e.metaKey && !e.ctrlKey) {
  const key = e.key.toLowerCase();
  if (key === 'b') {
    setActiveColor(blackBtn, "#000000", 2);
    updateSizeDisplay();
    draw();
    return;
  } else if (key === 'w') {
    setActiveColor(whiteBtn, "#ffffff", 30);
    updateSizeDisplay();
    draw();
    return;
  } else if (key === 'y' || key === 'h') {
    setActiveColor(yellowBtn, "#ffeb3b33", 12);
    updateSizeDisplay();
    draw();
    return;
  } else if (key === 'r' || key === 'm') {
    setActiveColor(redBtn, "#ff3333", 3);
    updateSizeDisplay();
    draw();
    return;
  }
}



// Typing input handling
if (isTyping && activeText) {
  e.preventDefault(); // prevent browser scroll etc.

  const { text, cursorPos, fontSize } = activeText;
  setTextContextFont(fontSize);
  const lines = text.split('\n');

  // Determine current line and column
  let charCount = 0;
  let lineIndex = 0;
  let columnIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (cursorPos <= charCount + lineLength) {
      lineIndex = i;
      columnIndex = cursorPos - charCount;
      break;
    }
    charCount += lineLength + 1; // +1 for '\n'
  }

  let newCursorPos = cursorPos;

  if (e.key === 'ArrowLeft') {
    newCursorPos = Math.max(0, cursorPos - 1);
  } else if (e.key === 'ArrowRight') {
    newCursorPos = Math.min(text.length, cursorPos + 1);
  } else if (e.key === 'ArrowUp' && lineIndex > 0) {
    const targetX = ctx.measureText(lines[lineIndex].slice(0, columnIndex)).width;
    const prevLine = lines[lineIndex - 1];
    let bestCol = 0;
    let minDiff = Infinity;
    for (let i = 0; i <= prevLine.length; i++) {
      const w = ctx.measureText(prevLine.slice(0, i)).width;
      const diff = Math.abs(w - targetX);
      if (diff < minDiff) {
        minDiff = diff;
        bestCol = i;
      }
    }
    newCursorPos = 0;
    for (let i = 0; i < lineIndex - 1; i++) {
      newCursorPos += lines[i].length + 1;
    }
    newCursorPos += bestCol;
  } else if (e.key === 'ArrowDown' && lineIndex < lines.length - 1) {
    const targetX = ctx.measureText(lines[lineIndex].slice(0, columnIndex)).width;
    const nextLine = lines[lineIndex + 1];
    let bestCol = 0;
    let minDiff = Infinity;
    for (let i = 0; i <= nextLine.length; i++) {
      const w = ctx.measureText(nextLine.slice(0, i)).width;
      const diff = Math.abs(w - targetX);
      if (diff < minDiff) {
        minDiff = diff;
        bestCol = i;
      }
    }
    newCursorPos = 0;
    for (let i = 0; i < lineIndex + 1; i++) {
      newCursorPos += lines[i].length + 1;
    }
    newCursorPos += bestCol;
  } else if (e.key === 'Backspace') {
    if (cursorPos > 0) {
      activeText.text = text.slice(0, cursorPos - 1) + text.slice(cursorPos);
      newCursorPos = cursorPos - 1;
    }
  } else if (e.key === 'Enter') {
    activeText.text = text.slice(0, cursorPos) + '\n' + text.slice(cursorPos);
    newCursorPos = cursorPos + 1;
  } else if (e.key.length === 1) {
    activeText.text = text.slice(0, cursorPos) + e.key + text.slice(cursorPos);
    newCursorPos = cursorPos + 1;
  }

  activeText.cursorPos = newCursorPos;
  resetTypingTimer();
  draw();
  return;
}


// 
});












function adjustSize(type, delta) {
  if (type === 'text') fontSize = Math.max(2, fontSize + delta);
  else brushSize = Math.max(1, Math.min(50, brushSize + delta));
  updateSizeDisplay();
  saveToLocalStorage();
  draw();
}











function isPointInRotatedRect(px, py, x, y, w, h, rotationDeg) {
  const rad = (rotationDeg || 0) * Math.PI / 180;

  // Translate point to rectangle’s coordinate system
  const dx = px - x;
  const dy = py - y;

  // Rotate point in opposite direction
  const rx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
  const ry = dx * Math.sin(-rad) + dy * Math.cos(-rad);

  return rx >= 0 && rx <= w && ry >= 0 && ry <= h;
}





// Mouse events
canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const isDashed = e.altKey;

  if (e.button === 2 && mode === 'text') {
    for (let i = actions.length - 1; i >= 0; i--) {
      const action = actions[i];
      if (action.type !== 'text') continue;

      const t = action.data;
      const { width, height } = getTextBoundingBox(t);

      if (isPointInRotatedRect(x, y, t.x, t.y, width, height, t.rotation || 0)) {
        const deleted = actions.splice(i, 1)[0];

        actions.push({
          type: 'delete',
          data: {
            item: deleted,
            index: i
          }
        });
        
        redoStack = []; // Clear redo history on new action

        stopTyping();
        saveToLocalStorage();
        draw();
        return;
      }
    }
  }


  // right click draw straight lines
  if (e.button === 2 && mode === 'draw') {

    const lastAction = actions[actions.length - 1];
    if (
      !lastAction ||
      lastAction.type !== 'stroke' ||
      lastAction.data.color !== currentStrokeColor ||
      lastAction.data.brushSize !== brushSize ||
      lastAction.data.isDashed !== isDashed
    ) {
      actions.push({
        type: 'stroke',
        data: {
          points: [],
          brushSize,
          color: currentStrokeColor,
          isDashed: isDashed
        }
      });

      redoStack = []; // Clear redo history on new action
      saveToLocalStorage();
    }

    const stroke = actions[actions.length - 1].data;
    stroke.points.push({ x, y });
    saveToLocalStorage();
    draw();

    return;
  }


  if (e.button === 0 && mode === 'text') {
    if (isTyping) {
      commitTextInput();
    }

    for (let i = actions.length - 1; i >= 0; i--) {
      const action = actions[i];
      if (action.type !== 'text') continue;

      const t = action.data;
      const { width, height } = getTextBoundingBox(t);

      if (isPointInRotatedRect(x, y, t.x, t.y, width, height, t.rotation || 0)) {
        // Potential drag start
        isDraggingText = true;
        draggingTextIndex = i;
        dragOffsetX = x - t.x;
        dragOffsetY = y - t.y;
        dragStartX = x;
        dragStartY = y;
        return;
      }
    }

    // No text block clicked — start new text input
    startTyping(x, y);
    return;
  }

  if (mode === 'draw') {
    isDrawing = true;

    if (e.metaKey || e.ctrlKey) {
      // Start circle mode
      isDrawingCircle = true;
      circleStartPoint = { x, y };

      currentCircle = {
        type: 'circle',
        data: {
          x,
          y,
          radius: 0,
          brushSize,
          color: currentStrokeColor,
          isDashed: isDashed
        }
      };
  } else {
  // Default or straight stroke mode
  isDrawingCircle = false;
  isStraightLine = e.shiftKey;

  actions.push({
    type: 'stroke',
    data: {
      points: [{ x, y }],
      brushSize,
      color: currentStrokeColor,
      isStraight: isStraightLine,
      isDashed: isDashed
    }
  });
}


    redoStack = [];
    saveToLocalStorage();
    draw();
  }

});












canvas.addEventListener('mousemove', e => {
  if (!isDraggingText && !isDrawing) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (isDraggingText) {
    // Update position of dragged text
    const action = actions[draggingTextIndex];
    if (!action) return;

    action.data.x = x - dragOffsetX;
    action.data.y = y - dragOffsetY;
    saveToLocalStorage();
    draw();
  } else if (isDrawing) {
    if (isDrawingCircle && currentCircle) {
      const dx = x - circleStartPoint.x;
      const dy = y - circleStartPoint.y;
      currentCircle.data.radius = Math.sqrt(dx * dx + dy * dy);
      draw(); // Show circle preview
    } else {
      const stroke = actions[actions.length - 1].data;
      
      if (stroke.isStraight) {
        // Replace second point if it exists
        if (stroke.points.length === 1) {
          stroke.points.push({ x, y });
        } else {
          stroke.points[1] = { x, y };
        }
      } else {
        stroke.points.push({ x, y });
      }

      saveToLocalStorage();
      draw();
    }
  }
});



// Helper to get cursor character index inside text based on click coords
function getCursorPositionInText(textData, clickX, clickY) {
  const { x, y, text, fontSize } = textData;
  setTextContextFont(fontSize);
  const lines = text.split('\n');

  // Calculate clicked line based on Y coordinate
  let lineIndex = Math.floor((clickY - y) / lineHeight);
  lineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));

  const line = lines[lineIndex];
  let cumulativeWidth = x;

  // Find char index by measuring widths
  for (let i = 0; i <= line.length; i++) {
    const substr = line.slice(0, i);
    const width = ctx.measureText(substr).width;
    if (cumulativeWidth + width >= clickX) {
      // Return char index relative to whole text
      let cursorPos = 0;
      for (let j = 0; j < lineIndex; j++) {
        cursorPos += lines[j].length + 1; // +1 for '\n'
      }
      return cursorPos + i;
    }
  }

  // If click is beyond end, put cursor at end of line
  let cursorPos = 0;
  for (let j = 0; j < lineIndex; j++) {
    cursorPos += lines[j].length + 1;
  }
  return cursorPos + line.length;
}

canvas.addEventListener('mouseup', e => {
  if (isDraggingText) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dx = x - dragStartX;
    const dy = y - dragStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < dragThreshold) {
      const action = actions[draggingTextIndex];
      if (action) {
        const cursorPos = getCursorPositionInText(action.data, x, y);
        startTyping(action.data.x, action.data.y, action, cursorPos);
      }
    }

    isDraggingText = false;
    draggingTextIndex = -1;
    saveToLocalStorage();
    draw();
  }

  if (isDrawing) {
    if (isDrawingCircle && currentCircle) {
      actions.push(currentCircle);
      currentCircle = null;
      circleStartPoint = null;
    }
    isDrawing = false;
    isDrawingCircle = false;
    saveToLocalStorage();
    draw();
  }
});



canvas.addEventListener('mouseleave', () => {
  isDrawing = false;
});





















function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function filterClosePoints(points, minDist = 1.5) {
    if (points.length <= 1) return points;
    const filtered = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - filtered[filtered.length - 1].x;
      const dy = points[i].y - filtered[filtered.length - 1].y;
      if (Math.hypot(dx, dy) >= minDist) {
        filtered.push(points[i]);
      }
    }
    return filtered;
  }

  for (let action of actions) {
    // skip active text action to avoid ghosting
    if (isTyping && activeText && action === activeText._action) {
      continue;
    }

    const { type, data } = action;

    if (type === 'text') {
      const { text, x, y, fontSize, color = "#000000", rotation = 0 } = data;
      setTextContextFont(fontSize);
      ctx.fillStyle = color;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation * Math.PI / 180);
      drawMultilineText(ctx, text, 0, 0);
      ctx.restore();

    } else if (type === 'stroke') {
      let { points, brushSize, color, isDashed, isStraight } = data;
      points = filterClosePoints(points);
      if (points.length < 2) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.setLineDash(isDashed ? [5, 5] : []);

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      if (isStraight && points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
      } else {
        for (let i = 1; i < points.length - 1; i++) {
          const midX = (points[i].x + points[i + 1].x) / 2;
          const midY = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      }

      ctx.stroke();

    } else if (type === 'circle') {
      const { x, y, radius, brushSize, color, isDashed } = data;

      ctx.setLineDash(isDashed ? [6, 4] : []);
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Live preview of circle while drawing
  if (currentCircle) {
    const { x, y, radius, brushSize, color, isDashed } = currentCircle.data;

    ctx.setLineDash(isDashed ? [6, 4] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);  // Reset to solid after preview
  }

  // Draw active text separately to avoid ghosting
  if (isTyping && activeText) {
    const { x, y, rotation = 0, fontSize, color, text } = activeText;
    const { width, height } = getTextBoundingBox(activeText);

    // Fill background behind rotated text
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation * Math.PI / 180);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    setTextContextFont(fontSize);
    ctx.fillStyle = color;
    drawMultilineText(ctx, text, 0, 0);

    // Draw blinking cursor at rotated position
    if (cursorVisible) {
      const lines = text.split('\n');
      let charIndex = 0;
      let cx = 0, cy = 0;

      for (let i = 0; i < lines.length; i++) {
        if (activeText.cursorPos <= charIndex + lines[i].length) {
          const before = lines[i].slice(0, activeText.cursorPos - charIndex);
          cx = ctx.measureText(before).width;
          cy = i * lineHeight;
          break;
        }
        charIndex += lines[i].length + 1;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = cursorLineWeight;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + lineHeight);
      ctx.stroke();
    }

    ctx.restore();
  }
}



// Helper: Render multi-line text
function drawMultilineText(ctx, text, x, y) {
  const lines = text.split('\n');
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}















// UNDO
function undoLastAction() {
  if (actions.length === 0) return;

  const lastAction = actions.pop();
  redoStack.push(lastAction); // store the undone action for redo

  if (lastAction.type === 'delete') {
    const { item, index } = lastAction.data;
    actions.splice(index, 0, item);
  } else {
    stopTyping(); // commit any typing before undoing other actions
  }

  saveToLocalStorage();
  draw();
}

// REDO
function redoLastAction() {
  if (redoStack.length === 0) return;

  const action = redoStack.pop();

  if (action.type === 'delete') {
    const { item, index } = action.data;
    actions.splice(index, 1); // re-delete the item
  } else {
    actions.push(action); // reapply the action
  }

  saveToLocalStorage();
  draw();
}













// COLORS
const blackBtn = document.getElementById('blackBtn');
const whiteBtn = document.getElementById('whiteBtn');
const yellowBtn = document.getElementById('yellowBtn');
const redBtn = document.getElementById('redBtn');
const customColorPicker = document.getElementById('customColorPicker');

// Initialize COLOR BUTTON STYLES
blackBtn.textContent = "Black";
blackBtn.style.backgroundColor = "#000000";
blackBtn.style.color = "#ffffff";

whiteBtn.textContent = "Whiteout";
whiteBtn.style.backgroundColor = "#ffffff";
whiteBtn.style.color = "#000000";

yellowBtn.textContent = "Highlight";
yellowBtn.style.backgroundColor = "#ffeb3b";
yellowBtn.style.color = "#000000";

redBtn.textContent = "Mark";
redBtn.style.backgroundColor = "#ff3333";
redBtn.style.color = "#ffffff";

// Set up click handlers to update currentStrokeColor
const colorButtons = document.querySelectorAll('.color-btn');


// Updated setActiveColor with brushSize
function setActiveColor(sourceElement, color, newBrushSize) {
  currentStrokeColor = color;
  brushSize = newBrushSize;
  
  // Update active state only for buttons in .color-btn list
  colorButtons.forEach(btn => {
    if (btn === sourceElement) {
      btn.classList.add('active-color');
    } else {
      btn.classList.remove('active-color');
    }
  });

  // Sync the color picker (remove alpha if present)
  let cleanColor = color.length === 9 ? color.slice(0, 7) : color;
  customColorPicker.value = cleanColor;

  if (mode === 'text' && isTyping && activeText) {
    activeText.color = color;
  }

  updateSizeDisplay();
  draw();
}

// Preset color button events with brush sizes
blackBtn.addEventListener('click', () => setActiveColor(blackBtn, "#000000", 2));
whiteBtn.addEventListener('click', () => setActiveColor(whiteBtn, "#ffffff", 30));
yellowBtn.addEventListener('click', () => setActiveColor(yellowBtn, "#ffeb3b55", 12));
redBtn.addEventListener('click', () => setActiveColor(redBtn, "#ff3333", 3));

// Custom color picker setup
document.addEventListener('DOMContentLoaded', () => {
  const customColorPicker = document.getElementById('customColorPicker');
  customColorPicker.value = '#94FFDB';
});

customColorPicker.addEventListener('input', (e) => {
  const pickedColor = e.target.value;
  setActiveColor(customColorPicker, pickedColor, brushSize); // Keep current brush size
});

// Set initial color + brush size
setActiveColor(blackBtn, "#000000", 2);













// MODAL
const infoBtn = document.getElementById('infoBtn');
const startBtn = document.getElementById('startBtn');
const modalOverlay = document.getElementById('modalOverlay');
const closeModalBtn = document.getElementById('closeModalBtn');

// Check localStorage on page load
if (localStorage.getItem('infoModalSeen') === 'true') {
  startBtn.classList.add('hidden');
}

// Function to open modal
function openModal() {
  modalOverlay.classList.remove('hidden');
  modalOverlay.classList.add('flex');
  localStorage.setItem('infoModalSeen', 'true');
  startBtn.classList.add('hidden');
}

// Open modal from either button
infoBtn.addEventListener('click', openModal);
startBtn.addEventListener('click', openModal);

// Close modal button
closeModalBtn.addEventListener('click', () => {
  modalOverlay.classList.remove('flex');
  modalOverlay.classList.add('hidden');
  infoBtn.blur();
});

// Click outside to close
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.classList.remove('flex');
    modalOverlay.classList.add('hidden');
  }
  infoBtn.blur();
});

// ESC key to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
    modalOverlay.classList.add('hidden');
  }
  infoBtn.blur();
});
