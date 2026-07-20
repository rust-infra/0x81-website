import { useRef, useEffect } from 'react';
import * as THREE from 'three';

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float u_progress;
  uniform vec2 u_resolution;
  uniform vec2 u_mouse;
  uniform float u_time;
  uniform float u_edgeScale;
  uniform float u_bleed;
  uniform vec3 u_inkColor;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    for(int i = 0; i < 4; i++) {
      sum += amp * snoise(p * freq);
      freq *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  float inkEdge(float dist, float edgeScale) {
    float n1 = fbm(vec2(dist * edgeScale * 12.0, dist * edgeScale * 8.0));
    float n2 = fbm(vec2(dist * edgeScale * 15.0 + 50.0, dist * edgeScale * 10.0 + 30.0));
    float combined = n1 * 0.6 + n2 * 0.4;
    return smoothstep(-0.3, 0.4, combined);
  }

  void main() {
    vec2 p = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    p.x *= aspect;
    vec2 center = vec2(0.5 * aspect, 0.5);
    float dist = length(p - center);

    float progress = u_progress + u_mouse.x;
    progress = clamp(progress, 0.0, 1.0);

    float noise1 = fbm(p * 3.0 + u_time * 0.1);
    float noise2 = fbm(p * 6.0 - u_time * 0.05);
    float organicNoise = noise1 * 0.7 + noise2 * 0.3;

    float threshold = progress + organicNoise * u_bleed * 0.3;
    threshold -= dist * 0.3;

    float edgeWidth = 0.08 * u_edgeScale;
    float inkAmount = smoothstep(threshold, threshold - edgeWidth, dist);

    float inkPattern = inkEdge(dist, u_edgeScale);

    vec3 paperColor = vec3(0.968, 0.960, 0.941);
    vec3 inkColor = u_inkColor;
    vec3 washColor = mix(paperColor, inkColor * 1.3, inkPattern * 0.5);
    vec3 finalColor = mix(washColor, inkColor, inkAmount);

    float detail = smoothstep(0.35, 0.65, noise2);
    finalColor = mix(finalColor, finalColor * 1.05, detail * (1.0 - inkAmount));

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

interface InkProgressProps {
  progress: number;
  className?: string;
}

export default function InkProgress({ progress, className = '' }: InkProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.offsetWidth || 300;
    const h = container.offsetHeight || 200;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.borderRadius = '24px';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      u_progress: { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()) },
      u_mouse: { value: new THREE.Vector2(0, 0) },
      u_time: { value: 0.0 },
      u_edgeScale: { value: 1.0 },
      u_bleed: { value: 1.0 },
      u_inkColor: { value: new THREE.Vector3(0.169, 0.169, 0.169) },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let startTime = performance.now();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) * 0.001;
      uniforms.u_time.value = elapsed;
      uniforms.u_progress.value += (progress - uniforms.u_progress.value) * 0.05;
      uniforms.u_mouse.value.x += (mouseRef.current.x - uniforms.u_mouse.value.x) * 0.1;
      uniforms.u_mouse.value.y += (mouseRef.current.y - uniforms.u_mouse.value.y) * 0.1;
      renderer.render(scene, camera);
    };
    animate();

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - rect.left) / rect.width;
      mouseRef.current.y = 1.0 - (e.clientY - rect.top) / rect.height;
    };

    const handleResize = () => {
      const nw = container.offsetWidth || 300;
      const nh = container.offsetHeight || 200;
      renderer.setSize(nw, nh);
      const pr = renderer.getPixelRatio();
      uniforms.u_resolution.value.set(nw * pr, nh * pr);
    };

    container.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      container.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [progress]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{ minHeight: '160px' }}
    />
  );
}
