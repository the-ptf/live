import { createFaceTracker } from "./face.js";

export const EFFECTS = [
  { id: "none", name: "None" },
  { id: "big-head", name: "Big head" },
  { id: "pinch", name: "Pinch" },
  { id: "fisheye", name: "Fisheye" },
  { id: "swirl", name: "Swirl" },
  { id: "funhouse", name: "Funhouse" },
  { id: "wave", name: "Wave" },
];
const MODE = Object.fromEntries(EFFECTS.map((effect, index) => [effect.id, index]));
const EFFECT_KEY = "milagre-live:effect";

export const loadEffect = () => (localStorage.getItem(EFFECT_KEY) in MODE ? localStorage.getItem(EFFECT_KEY) : "none");
export const saveEffect = (id) => localStorage.setItem(EFFECT_KEY, id);

const VERTEX = `attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// uv runs bottom to top. Each mode maps the output pixel to the camera pixel it shows; lens() magnifies inside its
// circle when k > 1 and shrinks when k < 1, meeting the untouched picture at the circle's edge.
const FRAGMENT = `precision mediump float;
varying vec2 uv;
uniform sampler2D camera;
uniform int mode;
uniform float time;
uniform float aspect;
uniform vec3 face;
uniform sampler2D person;
uniform float hasPerson;

vec2 lens(vec2 p, vec2 center, float radius, float k) {
  vec2 d = (p - center) * vec2(aspect, 1.0);
  float dist = length(d) / radius;
  if (dist >= 1.0 || dist < 0.0001) return p;
  return center + d / dist * pow(dist, k) * radius / vec2(aspect, 1.0);
}

// Scales everything inside the circle evenly by m (bigger when m > 1), easing back to the untouched picture near the
// edge, so a face grows or shrinks without bending.
vec2 zoom(vec2 p, vec2 center, float radius, float m) {
  vec2 d = (p - center) * vec2(aspect, 1.0);
  float dist = length(d) / radius;
  if (dist >= 1.0) return p;
  float scale = mix(1.0 / m, 1.0, smoothstep(0.55, 1.0, dist));
  return center + d * scale / vec2(aspect, 1.0);
}

// Snapchat's big head: the head, an oval around the face with a soft edge, drawn bigger from the chin up, so a giant
// head sits on a normal-size body.
vec4 bigHead(vec2 p, vec2 face, float size) {
  vec2 head = face + vec2(0.0, size * 0.14);
  vec2 radii = vec2(size * 0.78, size * 0.85);
  vec2 chin = vec2(face.x, face.y - size * 0.55);
  float grow = 1.8;
  vec2 q = chin + (p - chin) / grow;
  float dist = length((q - head) * vec2(aspect, 1.0) / radii);
  float inside = 1.0 - smoothstep(0.82, 1.0, dist);
  if (hasPerson > 0.5) inside *= smoothstep(0.35, 0.75, texture2D(person, clamp(q, 0.0, 1.0)).r);
  return mix(texture2D(camera, clamp(p, 0.0, 1.0)), texture2D(camera, clamp(q, 0.0, 1.0)), inside);
}

vec2 swirl(vec2 p, vec2 center, float radius, float turns) {
  vec2 d = (p - center) * vec2(aspect, 1.0);
  float dist = length(d) / radius;
  if (dist >= 1.0) return p;
  float angle = turns * (1.0 - dist) * (1.0 - dist);
  float s = sin(angle);
  float c = cos(angle);
  return center + vec2(d.x * c - d.y * s, d.x * s + d.y * c) / vec2(aspect, 1.0);
}

void main() {
  vec2 p = uv;
  vec2 center = face.xy;
  float size = face.z;
  if (mode == 1) {
    gl_FragColor = bigHead(p, center, size);
    return;
  }
  if (mode == 2) p = zoom(p, center, size * 1.0, 0.6);
  else if (mode == 3) p = lens(p, center, max(0.6, size * 2.1), 1.45);
  else if (mode == 4) p = swirl(p, center, size * 1.35, 3.2 + sin(time * 0.8) * 0.6);
  else if (mode == 5) p.x = center.x + (p.x - center.x) * (1.0 + 0.65 * cos((p.y - center.y) * 3.1416));
  else if (mode == 6) p += vec2(0.025 * sin(p.y * 18.0 + time * 4.0), 0.018 * sin(p.x * 14.0 + time * 3.0));
  gl_FragColor = texture2D(camera, clamp(p, 0.0, 1.0));
}`;

function program(gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    return shader;
  };
  const linked = gl.createProgram();
  gl.attachShader(linked, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(linked, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked) ?? "program");
  return linked;
}

/**
 * Runs a camera track through the distortion shader into a canvas and returns the canvas's own track. Null where the
 * browser has no WebGL or can't capture a canvas; the caller sends the plain camera then.
 */
export function createEffectCamera(cameraTrack, effect) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl || !canvas.captureStream) return null;
  const linked = program(gl);
  gl.useProgram(linked);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(linked, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [name, value] of [
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
  ])
    gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const uniforms = {
    mode: gl.getUniformLocation(linked, "mode"),
    time: gl.getUniformLocation(linked, "time"),
    aspect: gl.getUniformLocation(linked, "aspect"),
    face: gl.getUniformLocation(linked, "face"),
    person: gl.getUniformLocation(linked, "person"),
    hasPerson: gl.getUniformLocation(linked, "hasPerson"),
  };
  gl.uniform1i(gl.getUniformLocation(linked, "camera"), 0);
  gl.uniform1i(uniforms.person, 1);
  const personTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, personTexture);
  for (const [name, value] of [
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
  ])
    gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.activeTexture(gl.TEXTURE0);
  let maskVersion = 0;

  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: new MediaStream([cameraTrack]) });
  video.play().catch(() => {});
  const { width = 1280, height = 720 } = cameraTrack.getSettings();
  canvas.width = width;
  canvas.height = height;
  const [track] = canvas.captureStream(30).getVideoTracks();
  let mode = MODE[effect] ?? 0;
  let stopped = false;
  // Big head, Pinch, Fisheye, Swirl and Funhouse center on the face; Wave moves the whole picture.
  const followsFace = () => mode >= 1 && mode <= 5;
  let tracker = followsFace() ? createFaceTracker(video) : null;
  tracker?.useMask(mode === 1);
  const started = performance.now();

  const draw = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      const mask = mode === 1 ? tracker?.mask : null;
      if (mask && mask.version !== maskVersion) {
        maskVersion = mask.version;
        gl.activeTexture(gl.TEXTURE1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask.data);
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.uniform1f(uniforms.hasPerson, mask ? 1 : 0);
      gl.uniform1i(uniforms.mode, mode);
      gl.uniform1f(uniforms.time, (performance.now() - started) / 1000);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      const face = tracker?.step() ?? { x: 0.5, y: 0.52, size: 0.42 };
      gl.uniform3f(uniforms.face, face.x, face.y, face.size);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    schedule();
  };
  const schedule = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw));
  schedule();

  return {
    track,
    setEffect(id) {
      mode = MODE[id] ?? 0;
      if (followsFace()) tracker ??= createFaceTracker(video);
      tracker?.useMask(mode === 1);
    },
    get tracker() {
      return tracker;
    },
    stop() {
      stopped = true;
      tracker?.stop();
      track.stop();
      video.srcObject = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
