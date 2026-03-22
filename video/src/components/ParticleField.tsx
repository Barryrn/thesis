import { useCurrentFrame, interpolate } from "remotion";
import { COLORS } from "../constants";

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  phase: number;
}

// Deterministic pseudo-random based on seed
const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
};

const generateParticles = (count: number): Particle[] => {
  return Array.from({ length: count }, (_, i) => ({
    x: seededRandom(i * 3 + 1) * 100,
    y: seededRandom(i * 3 + 2) * 100,
    size: seededRandom(i * 3 + 3) * 4 + 1,
    speed: seededRandom(i * 7 + 5) * 0.3 + 0.1,
    opacity: seededRandom(i * 7 + 8) * 0.5 + 0.2,
    phase: seededRandom(i * 7 + 11) * Math.PI * 2,
  }));
};

interface ParticleFieldProps {
  count?: number;
  color?: string;
}

export const ParticleField: React.FC<ParticleFieldProps> = ({
  count = 30,
  color = COLORS.primary,
}) => {
  const frame = useCurrentFrame();
  const particles = generateParticles(count);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {particles.map((p, i) => {
        const y = (p.y - frame * p.speed * 0.5) % 110;
        const adjustedY = y < -10 ? y + 120 : y;
        const twinkle = Math.sin(frame * 0.08 + p.phase) * 0.3 + 0.7;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${adjustedY}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: color,
              opacity: p.opacity * twinkle,
              boxShadow: `0 0 ${p.size * 2}px ${color}60`,
            }}
          />
        );
      })}
    </div>
  );
};
