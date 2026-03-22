export interface Segment {
  id: string;
  label: string;
  emoji: string;
  startSec: number;
  endSec: number;
  color: string;
}

export const SEGMENTS: Segment[] = [
  {
    id: "hook",
    label: "Hook",
    emoji: "🎯",
    startSec: 0,
    endSec: 3.6,
    color: "#FFC211",
  },
  {
    id: "problem",
    label: "Das Problem",
    emoji: "😩",
    startSec: 3.9,
    endSec: 13.9,
    color: "#ef4444",
  },
  {
    id: "solution",
    label: "Die Lösung",
    emoji: "💡",
    startSec: 14.2,
    endSec: 22.8,
    color: "#22c55e",
  },
  {
    id: "outline",
    label: "Feature: Gliederung",
    emoji: "📋",
    startSec: 23.3,
    endSec: 33.4,
    color: "#7ab07a",
  },
  {
    id: "papers",
    label: "Feature: Papers",
    emoji: "📄",
    startSec: 33.9,
    endSec: 40.9,
    color: "#7a9ab0",
  },
  {
    id: "linking",
    label: "Feature: Verknüpfung",
    emoji: "🔗",
    startSec: 41.3,
    endSec: 53.4,
    color: "#a78bfa",
  },
  {
    id: "auto",
    label: "Automatisch",
    emoji: "⚡",
    startSec: 53.4,
    endSec: 69.4,
    color: "#FFC211",
  },
  {
    id: "manual",
    label: "Manuell",
    emoji: "✏️",
    startSec: 69.8,
    endSec: 76.0,
    color: "#f97316",
  },
  {
    id: "value",
    label: "Mehrwert",
    emoji: "🚀",
    startSec: 76.3,
    endSec: 88.5,
    color: "#22c55e",
  },
  {
    id: "cta",
    label: "Jetzt starten!",
    emoji: "🔥",
    startSec: 89.0,
    endSec: 104.6,
    color: "#FFC211",
  },
];
