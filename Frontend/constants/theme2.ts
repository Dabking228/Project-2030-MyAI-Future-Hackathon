export const Colors = {
  // Core palette
  background: "#0A0F1E", // Deep navy — main screen background
  surface: "#111827", // Slightly lighter — card/sheet backgrounds
  surfaceAlt: "#1A2235", // Border-level surfaces, input backgrounds
  border: "#1F2D45", // Subtle dividers

  // Brand
  teal: "#00D4B8", // Primary accent — electric teal
  tealDim: "#00A896", // Pressed/active state
  tealGlow: "rgba(0, 212, 184, 0.15)", // Glow halos

  // Transport mode colours (used on map and route cards)
  rail: "#6C63FF", // Purple — LRT/MRT/KTM
  bus: "#F59E0B", // Amber — bus
  walk: "#64748B", // Slate — walking segment

  // Status
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",

  // Text
  textPrimary: "#F1F5F9", // Near-white
  textSecondary: "#94A3B8", // Muted
  textDim: "#475569", // Very muted / placeholders

  // Chat bubbles
  bubbleUser: "#00D4B8", // Teal fill for user
  bubbleAgent: "#1A2235", // Dark surface for agent
  bubbleUserText: "#0A0F1E",
  bubbleAgentText: "#F1F5F9",

  // Map overlay
  mapPolylineRail: "#6C63FF",
  mapPolylineBus: "#F59E0B",
  mapPolylineWalk: "#64748B",
  mapPolylineWalkDash: "#94A3B8",
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 28,
  full: 999,
};

export const Typography = {
  // Display: used for headings, station names
  displayFamily: "SpaceGrotesk-Bold", // fallback: System bold
  // Body: used for instructions, descriptions
  bodyFamily: "Inter-Regular",
  bodyMedium: "Inter-Medium",
  bodySemiBold: "Inter-SemiBold",

  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
    hero: 32,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    loose: 1.8,
  },
};

// Map colour for each transport segment type
export function modeColor(agencyType: string): string {
  switch (agencyType) {
    case "rail":
      return Colors.rail;
    case "bus":
      return Colors.bus;
    case "walk":
      return Colors.walk;
    default:
      return Colors.teal;
  }
}

// Mode label for display
export function modeLabel(agencyType: string): string {
  switch (agencyType) {
    case "rail":
      return "Train";
    case "bus":
      return "Bus";
    case "walk":
      return "Walk";
    default:
      return "Transit";
  }
}

export function modeIcon(agencyType: string): string {
  switch (agencyType) {
    case "rail":
      return "🚆";
    case "bus":
      return "🚌";
    case "walk":
      return "🚶";
    default:
      return "🚌";
  }
}
