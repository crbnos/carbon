/**
 * Stub for Node's `canvas` package. Konva's `lib/index-node.js` requires it
 * when Vite SSR evaluates `konva`; we avoid installing native `canvas`.
 * SSR does not render Konva output; this only needs to load without throwing.
 */
"use strict";

class ImageStub {
  constructor() {
    this.src = "";
    this.onload = null;
    this.onerror = null;
  }
}

function createCanvas() {
  return {
    width: 300,
    height: 300,
    style: {},
    getContext() {
      return {
        canvas: null,
        fillRect() {},
        clearRect() {},
        drawImage() {},
        fill() {},
        stroke() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        rect() {},
        clip() {},
        save() {},
        restore() {},
        translate() {},
        scale() {},
        rotate() {},
        measureText() {
          return { width: 0 };
        }
      };
    }
  };
}

const DOMMatrixStub =
  typeof globalThis.DOMMatrix !== "undefined"
    ? globalThis.DOMMatrix
    : class DOMMatrixStubInner {
        constructor() {}
      };

const api = {
  createCanvas,
  Image: ImageStub,
  DOMMatrix: DOMMatrixStub
};

module.exports = api;
module.exports.default = api;
