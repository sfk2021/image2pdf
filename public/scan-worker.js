/* Runs off the main thread so the UI never freezes while scanning.
   Plain JavaScript, no imports. */
"use strict";

// Snap the page shape to A4 / Letter when it is within 4% of them.
// Set to false if you scan things that are close to, but not exactly, these sizes.
var SNAP_TO_PAPER = true;

// Typical phone camera focal length as a fraction of the photo's longer side
var DEFAULT_F = 0.75;

var FULL = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

self.onmessage = function (e) {
  var m = e.data;
  try {
    var data = new Uint8ClampedArray(m.buffer);

    if (m.type === "detect") {
      self.postMessage({ id: m.id, corners: detectCorners(data, m.width, m.height) });
      return;
    }

    var corners = m.corners || null;
    if (m.detect) corners = detectCorners(data, m.width, m.height);

    var out;
    if (!corners && Math.max(m.width, m.height) <= m.maxOut) {
      out = { data: data, width: m.width, height: m.height };
    } else {
      out = warp(data, m.width, m.height, corners || FULL, m.maxOut);
    }

    applyFilter(out.data, out.width, out.height, m.filter);
    applyAdjust(out.data, m.brightness || 0, m.contrast || 0);

    self.postMessage(
      {
        id: m.id,
        width: out.width,
        height: out.height,
        buffer: out.data.buffer,
        corners: corners,
      },
      [out.data.buffer]
    );
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};

/* ---------------- Page detection ---------------- */

function otsu(g) {
  var hist = new Array(256);
  var t;
  for (t = 0; t < 256; t++) hist[t] = 0;
  for (var i = 0; i < g.length; i++) hist[g[i]]++;
  var total = g.length;
  var sum = 0;
  for (t = 0; t < 256; t++) sum += t * hist[t];
  var sumB = 0;
  var wB = 0;
  var max = 0;
  var thr = 128;
  for (t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    var wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    var mB = sumB / wB;
    var mF = (sum - sumB) / wF;
    var between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      thr = t;
    }
  }
  return thr;
}

// Binary dilate (any 1 in window) or erode (all 1 in window), separable box window
function morph(src, w, h, r, dilate) {
  var size = 2 * r + 1;
  var outside = dilate ? 0 : 1;
  var tmp = new Uint8Array(w * h);
  var out = new Uint8Array(w * h);
  var x, y, k, cnt, rm, ad;

  for (y = 0; y < h; y++) {
    cnt = 0;
    for (k = -r; k <= r; k++) cnt += k < 0 || k >= w ? outside : src[y * w + k];
    for (x = 0; x < w; x++) {
      tmp[y * w + x] = dilate ? (cnt > 0 ? 1 : 0) : cnt === size ? 1 : 0;
      rm = x - r;
      ad = x + r + 1;
      cnt -= rm < 0 || rm >= w ? outside : src[y * w + rm];
      cnt += ad < 0 || ad >= w ? outside : src[y * w + ad];
    }
  }

  for (x = 0; x < w; x++) {
    cnt = 0;
    for (k = -r; k <= r; k++) cnt += k < 0 || k >= h ? outside : tmp[k * w + x];
    for (y = 0; y < h; y++) {
      out[y * w + x] = dilate ? (cnt > 0 ? 1 : 0) : cnt === size ? 1 : 0;
      rm = y - r;
      ad = y + r + 1;
      cnt -= rm < 0 || rm >= h ? outside : tmp[rm * w + x];
      cnt += ad < 0 || ad >= h ? outside : tmp[ad * w + x];
    }
  }
  return out;
}

function polyArea(P) {
  var a = 0;
  for (var i = 0; i < P.length; i++) {
    var j = (i + 1) % P.length;
    a += P[i][0] * P[j][1] - P[j][0] * P[i][1];
  }
  return Math.abs(a) / 2;
}

function convexHull(pts) {
  pts.sort(function (a, b) {
    return a[0] - b[0] || a[1] - b[1];
  });
  var u = [];
  var i;
  for (i = 0; i < pts.length; i++) {
    if (!i || pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) u.push(pts[i]);
  }
  if (u.length < 3) return u;

  var cross = function (o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  };
  var lower = [];
  for (i = 0; i < u.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], u[i]) <= 0) {
      lower.pop();
    }
    lower.push(u[i]);
  }
  var upper = [];
  for (i = u.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], u[i]) <= 0) {
      upper.pop();
    }
    upper.push(u[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Reduces a convex polygon to 4 corners by repeatedly replacing the edge that adds
// the least area with the point where its two neighbours meet (so the result
// wraps around the shape and the corners land on the real page corners).
function hullToQuad(H) {
  var v = H.slice();
  while (v.length > 4) {
    var n = v.length;
    var bestI = -1;
    var bestArea = Infinity;
    var bestX = null;

    for (var i = 0; i < n; i++) {
      var P = v[(i + n - 1) % n];
      var A = v[i];
      var B = v[(i + 1) % n];
      var N = v[(i + 2) % n];

      var d1x = A[0] - P[0], d1y = A[1] - P[1];
      var d2x = B[0] - N[0], d2y = B[1] - N[1];
      var den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;

      var npx = N[0] - P[0], npy = N[1] - P[1];
      var t = (npx * d2y - npy * d2x) / den;
      var s = (npx * d1y - npy * d1x) / den;
      if (t <= 1 || s <= 1) continue; // the two edges don't meet beyond this edge

      var X = [P[0] + t * d1x, P[1] + t * d1y];
      var area = Math.abs((X[0] - A[0]) * (B[1] - A[1]) - (X[1] - A[1]) * (B[0] - A[0])) / 2;
      if (area < bestArea) {
        bestArea = area;
        bestI = i;
        bestX = X;
      }
    }

    if (bestI < 0) {
      // no edge can be replaced: drop the vertex that changes the shape the least
      var minA = Infinity;
      var minI = 0;
      for (var j = 0; j < n; j++) {
        var a = v[(j + n - 1) % n], b = v[j], c = v[(j + 1) % n];
        var ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
        if (ar < minA) {
          minA = ar;
          minI = j;
        }
      }
      v.splice(minI, 1);
      continue;
    }

    var ia = bestI;
    var ib = (bestI + 1) % n;
    if (ib > ia) {
      v.splice(ia, 2, bestX);
    } else {
      v.splice(ia, 1);
      v.splice(0, 1, bestX);
    }
  }
  return v.length === 4 ? v : null;
}

// Orders 4 corners as top-left, top-right, bottom-right, bottom-left
function orderCorners(q) {
  var cx = 0, cy = 0, i;
  for (i = 0; i < 4; i++) {
    cx += q[i][0] / 4;
    cy += q[i][1] / 4;
  }
  // ascending angle on screen = clockwise
  var a = q.slice().sort(function (p, r) {
    return Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(r[1] - cy, r[0] - cx);
  });
  // the top edge is the one with the smallest middle y
  var best = 0;
  var bestY = Infinity;
  for (i = 0; i < 4; i++) {
    var my = (a[i][1] + a[(i + 1) % 4][1]) / 2;
    if (my < bestY) {
      bestY = my;
      best = i;
    }
  }
  return [a[best], a[(best + 1) % 4], a[(best + 2) % 4], a[(best + 3) % 4]];
}

// Largest blob in the mask -> four corner points, or null if it doesn't look like a page
function largestQuad(mask, w, h) {
  var total = w * h;
  var visited = new Uint8Array(total);
  var stack = new Int32Array(total);
  var curMin = new Int32Array(h);
  var curMax = new Int32Array(h);
  var bestMin = null;
  var bestMax = null;
  var bestCnt = 0;

  for (var s = 0; s < total; s++) {
    if (!mask[s] || visited[s]) continue;

    curMin.fill(0x7fffffff);
    curMax.fill(-1);
    var sp = 0;
    stack[sp++] = s;
    visited[s] = 1;
    var cnt = 0;

    while (sp) {
      var p = stack[--sp];
      var px = p % w;
      var py = (p / w) | 0;
      cnt++;
      if (px < curMin[py]) curMin[py] = px;
      if (px > curMax[py]) curMax[py] = px;

      if (px > 0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1; }
      if (px < w - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1; }
      if (py > 0 && mask[p - w] && !visited[p - w]) { visited[p - w] = 1; stack[sp++] = p - w; }
      if (py < h - 1 && mask[p + w] && !visited[p + w]) { visited[p + w] = 1; stack[sp++] = p + w; }
    }

    if (cnt > bestCnt) {
      bestCnt = cnt;
      bestMin = curMin.slice();
      bestMax = curMax.slice();
    }
  }

  if (!bestMin) return null;
  if (bestCnt < 0.12 * total || bestCnt > 0.97 * total) return null;

  // Row extremes are enough to build the exact convex hull of the blob
  var pts = [];
  for (var y = 0; y < h; y++) {
    if (bestMax[y] < 0) continue;
    var x0 = bestMin[y];
    var x1 = bestMax[y] + 1;
    pts.push([x0, y], [x0, y + 1], [x1, y], [x1, y + 1]);
  }
  var hull = convexHull(pts);
  if (hull.length < 4) return null;

  var quad = hullToQuad(hull);
  if (!quad) return null;

  var i;
  for (i = 0; i < 4; i++) {
    quad[i][0] = Math.min(w, Math.max(0, quad[i][0]));
    quad[i][1] = Math.min(h, Math.max(0, quad[i][1]));
  }

  var qa = polyArea(quad);
  if (qa < 0.12 * total) return null;
  var solidity = bestCnt / qa;
  if (solidity < 0.75 || solidity > 1.15) return null;

  var o = orderCorners(quad);
  var corners = [];
  for (i = 0; i < 4; i++) corners.push({ x: o[i][0] / w, y: o[i][1] / h });
  return { corners: corners, score: Math.min(solidity, 1) * (bestCnt / total) };
}

function detectCorners(data, w, h) {
  var f = Math.max(1, Math.floor(Math.max(w, h) / 320));
  var sw = Math.floor(w / f);
  var sh = Math.floor(h / f);
  if (sw < 16 || sh < 16) return null;

  // small grayscale copy (block average)
  var gray = new Uint8Array(sw * sh);
  var area = f * f;
  var x, y, xx, yy, i;
  for (y = 0; y < sh; y++) {
    for (x = 0; x < sw; x++) {
      var sum = 0;
      for (yy = 0; yy < f; yy++) {
        var row = ((y * f + yy) * w + x * f) * 4;
        for (xx = 0; xx < f; xx++) {
          i = row + xx * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
      }
      gray[y * sw + x] = sum / area;
    }
  }

  var t = otsu(gray);
  var r = Math.max(2, Math.round(Math.max(sw, sh) / 70));
  var best = null;

  // pass 0: light page on a darker surface. pass 1: dark page on a lighter surface
  for (var pass = 0; pass < 2; pass++) {
    var mask = new Uint8Array(sw * sh);
    for (i = 0; i < mask.length; i++) {
      mask[i] = pass === 0 ? (gray[i] > t ? 1 : 0) : gray[i] <= t ? 1 : 0;
    }
    mask = morph(morph(mask, sw, sh, r, true), sw, sh, r, false); // close small holes (text)
    var q = largestQuad(mask, sw, sh);
    if (q && (!best || q.score > best.score)) best = q;
  }

  return best ? best.corners : null;
}

/* ---------------- Perspective-correct page shape ---------------- */

// Gauss-Jordan solve of an n x n system (modifies A)
function solve(A, b) {
  var n = b.length;
  var i, r, c, col;
  for (i = 0; i < n; i++) A[i].push(b[i]);
  for (col = 0; col < n; col++) {
    var piv = col;
    for (r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    var tmp = A[col];
    A[col] = A[piv];
    A[piv] = tmp;
    for (r = 0; r < n; r++) {
      if (r === col) continue;
      var f = A[r][col] / A[col][col];
      for (c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  var out = [];
  for (i = 0; i < n; i++) out.push(A[i][n] / A[i][i]);
  return out;
}

// Real width / height of the page, from how its four corners look in the photo.
// P = corners in pixels (top-left, top-right, bottom-right, bottom-left).
// Returns 0 if it can't be worked out.
function pageAspect(P, sw, sh) {
  var L = Math.max(sw, sh);
  var cx = sw / 2;
  var cy = sh / 2;
  var m1 = [P[0].x - cx, P[0].y - cy]; // top-left
  var m2 = [P[1].x - cx, P[1].y - cy]; // top-right
  var m4 = [P[2].x - cx, P[2].y - cy]; // bottom-right
  var m3 = [P[3].x - cx, P[3].y - cy]; // bottom-left

  // depth of each corner, relative to the top-left corner
  var lam = solve(
    [
      [m2[0], m3[0], -m4[0]],
      [m2[1], m3[1], -m4[1]],
      [1, 1, -1],
    ],
    [m1[0], m1[1], 1]
  );
  if (!lam) return 0;
  var l2 = lam[0];
  var l3 = lam[1];
  var l4 = lam[2];
  if (!(l2 > 0 && l3 > 0 && l4 > 0)) return 0;

  // page edges (top-left -> top-right, top-left -> bottom-left) in camera space
  var n2 = [l2 * m2[0] - m1[0], l2 * m2[1] - m1[1], l2 - 1];
  var n3 = [l3 * m3[0] - m1[0], l3 * m3[1] - m1[1], l3 - 1];

  // focal length: assume a typical phone, refine it when the photo allows
  var f = DEFAULT_F * L;
  if (Math.abs(n2[2]) > 0.03 && Math.abs(n3[2]) > 0.03) {
    var f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (f2 > 0) {
      var fe = Math.sqrt(f2);
      if (fe > 0.5 * L && fe < 1.3 * L) f = fe;
    }
  }

  var wl = Math.sqrt((n2[0] * n2[0] + n2[1] * n2[1]) / (f * f) + n2[2] * n2[2]);
  var hl = Math.sqrt((n3[0] * n3[0] + n3[1] * n3[1]) / (f * f) + n3[2] * n3[2]);
  if (!(wl > 0) || !(hl > 0)) return 0;
  return wl / hl;
}

function snapRatio(r) {
  var known = [1 / Math.SQRT2, Math.SQRT2, 8.5 / 11, 11 / 8.5]; // A4 and Letter, portrait + landscape
  for (var i = 0; i < known.length; i++) {
    if (Math.abs(r / known[i] - 1) < 0.04) return known[i];
  }
  return r;
}

// maps dst-space points to src-space points
function homography(dst, src) {
  var A = [];
  var b = [];
  for (var i = 0; i < 4; i++) {
    var x = dst[i].x, y = dst[i].y, u = src[i].x, v = src[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return solve(A, b);
}

function warp(src, sw, sh, corners, maxOut) {
  var P = [];
  var i;
  for (i = 0; i < 4; i++) P.push({ x: corners[i].x * sw, y: corners[i].y * sh });

  var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
  var Lh = Math.max(dist(P[0], P[1]), dist(P[3], P[2])); // longest horizontal edge
  var Lv = Math.max(dist(P[0], P[3]), dist(P[1], P[2])); // longest vertical edge

  // true page shape (not the stretched shape seen in the photo)
  var ratio = pageAspect(P, sw, sh);
  if (!(ratio > 0.05 && ratio < 20)) ratio = Lh / Math.max(Lv, 1);
  if (SNAP_TO_PAPER) ratio = snapRatio(ratio);

  var ow = Math.max(Lh, Lv * ratio);
  var oh = ow / ratio;
  var k = Math.min(1, maxOut / Math.max(ow, oh, 1));
  ow = Math.max(2, Math.round(ow * k));
  oh = Math.max(2, Math.round(oh * k));

  var H = homography(
    [{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }],
    P
  );
  if (!H) H = [sw / ow, 0, 0, 0, sh / oh, 0, 0, 0]; // degenerate: just scale the image

  var out = new Uint8ClampedArray(ow * oh * 4);
  for (var y = 0; y < oh; y++) {
    for (var x = 0; x < ow; x++) {
      var px = x + 0.5;
      var py = y + 0.5;
      var d = H[6] * px + H[7] * py + 1;
      var u = (H[0] * px + H[1] * py + H[2]) / d - 0.5;
      var v = (H[3] * px + H[4] * py + H[5]) / d - 0.5;
      if (u < 0) u = 0; else if (u > sw - 1) u = sw - 1;
      if (v < 0) v = 0; else if (v > sh - 1) v = sh - 1;

      var x0 = u | 0;
      var y0 = v | 0;
      var x1 = x0 + 1 < sw ? x0 + 1 : x0;
      var y1 = y0 + 1 < sh ? y0 + 1 : y0;
      var fx = u - x0;
      var fy = v - y0;
      var i00 = (y0 * sw + x0) * 4;
      var i10 = (y0 * sw + x1) * 4;
      var i01 = (y1 * sw + x0) * 4;
      var i11 = (y1 * sw + x1) * 4;
      var o = (y * ow + x) * 4;

      for (var c = 0; c < 3; c++) {
        var top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        var bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: ow, height: oh };
}

/* ---------------- Filters ---------------- */

// Estimated paper/lighting colour per area (3 channels per pixel), used to remove shadows
function background(d, w, h) {
  var f = Math.max(8, Math.round(Math.max(w, h) / 60));
  var bw = Math.ceil(w / f);
  var bh = Math.ceil(h / f);
  var grid = new Float32Array(bw * bh * 3);
  var bx, by, x, y, i;

  for (by = 0; by < bh; by++) {
    for (bx = 0; bx < bw; bx++) {
      var x0 = bx * f, y0 = by * f;
      var x1 = Math.min(w, x0 + f), y1 = Math.min(h, y0 + f);

      var sum = 0, n = 0;
      for (y = y0; y < y1; y++) {
        for (x = x0; x < x1; x++) {
          i = (y * w + x) * 4;
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          n++;
        }
      }
      var mean = sum / n;

      // average only the brighter half so dark text doesn't darken the estimate
      var r = 0, g = 0, b = 0, m = 0;
      for (y = y0; y < y1; y++) {
        for (x = x0; x < x1; x++) {
          i = (y * w + x) * 4;
          var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum >= mean) {
            r += d[i]; g += d[i + 1]; b += d[i + 2]; m++;
          }
        }
      }
      var o = (by * bw + bx) * 3;
      if (m === 0) {
        grid[o] = grid[o + 1] = grid[o + 2] = mean;
      } else {
        grid[o] = r / m; grid[o + 1] = g / m; grid[o + 2] = b / m;
      }
    }
  }

  // bilinear upsample to full size
  var bg = new Uint8ClampedArray(w * h * 3);
  var xa = new Int32Array(w), xb = new Int32Array(w), xw = new Float32Array(w);
  for (x = 0; x < w; x++) {
    var gx = (x + 0.5) / f - 0.5;
    if (gx < 0) gx = 0;
    if (gx > bw - 1) gx = bw - 1;
    var a0 = gx | 0;
    xa[x] = a0;
    xb[x] = Math.min(bw - 1, a0 + 1);
    xw[x] = gx - a0;
  }
  for (y = 0; y < h; y++) {
    var gy = (y + 0.5) / f - 0.5;
    if (gy < 0) gy = 0;
    if (gy > bh - 1) gy = bh - 1;
    var ya = gy | 0;
    var yb = Math.min(bh - 1, ya + 1);
    var wy = gy - ya;
    for (x = 0; x < w; x++) {
      var wx = xw[x];
      for (var c = 0; c < 3; c++) {
        var top = grid[(ya * bw + xa[x]) * 3 + c] * (1 - wx) + grid[(ya * bw + xb[x]) * 3 + c] * wx;
        var bot = grid[(yb * bw + xa[x]) * 3 + c] * (1 - wx) + grid[(yb * bw + xb[x]) * 3 + c] * wx;
        bg[(y * w + x) * 3 + c] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return bg;
}

function applyFilter(d, w, h, filter) {
  if (!filter || filter === "original") return;
  var bg = background(d, w, h);
  var n = w * h;
  for (var p = 0, i = 0, j = 0; p < n; p++, i += 4, j += 3) {
    if (filter === "magic") {
      for (var c = 0; c < 3; c++) {
        var v = (d[i + c] / Math.max(bg[j + c], 1)) * 255;
        d[i + c] = ((v - 35) * 255) / 200;
      }
    } else {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var bl = Math.max(0.299 * bg[j] + 0.587 * bg[j + 1] + 0.114 * bg[j + 2], 1);
      var v2 = (lum / bl) * 255;
      var o = filter === "gray" ? ((v2 - 35) * 255) / 200 : ((v2 - 120) * 255) / 75;
      d[i] = o;
      d[i + 1] = o;
      d[i + 2] = o;
    }
  }
}

function applyAdjust(d, brightness, contrast) {
  if (!brightness && !contrast) return;
  var f = 1 + contrast / 100;
  var b = brightness * 1.28;
  for (var i = 0; i < d.length; i += 4) {
    d[i] = (d[i] - 128) * f + 128 + b;
    d[i + 1] = (d[i + 1] - 128) * f + 128 + b;
    d[i + 2] = (d[i + 2] - 128) * f + 128 + b;
  }
}