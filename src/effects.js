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

vec2 lens(vec2 p, vec2 center, float radius, float k) {
  vec2 d = (p - center) * vec2(aspect, 1.0);
  float dist = length(d) / radius;
  if (dist >= 1.0 || dist < 0.0001) return p;
  return center + d / dist * pow(dist, k) * radius / vec2(aspect, 1.0);
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
  if (mode == 1) p = lens(p, vec2(0.5, 0.58), 0.46, 1.9);
  else if (mode == 2) p = lens(p, vec2(0.5, 0.52), 0.5, 0.55);
  else if (mode == 3) p = lens(p, vec2(0.5, 0.5), 0.85, 1.45);
  else if (mode == 4) p = swirl(p, vec2(0.5, 0.52), 0.55, 3.2 + sin(time * 0.8) * 0.6);
  else if (mode == 5) p.x = 0.5 + (p.x - 0.5) * (1.0 + 0.65 * cos((p.y - 0.5) * 3.1416));
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
  };

  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: new MediaStream([cameraTrack]) });
  video.play().catch(() => {});
  const { width = 1280, height = 720 } = cameraTrack.getSettings();
  canvas.width = width;
  canvas.height = height;
  const [track] = canvas.captureStream(30).getVideoTracks();
  let mode = MODE[effect] ?? 0;
  let stopped = false;
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
      gl.uniform1i(uniforms.mode, mode);
      gl.uniform1f(uniforms.time, (performance.now() - started) / 1000);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
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
    },
    stop() {
      stopped = true;
      track.stop();
      video.srcObject = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
