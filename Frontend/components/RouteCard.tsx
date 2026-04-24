import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Colors,
  Radius,
  Spacing,
  Typography,
  modeColor,
  modeIcon,
} from "../constants/theme2";
import type { RouteResult } from "../services/api";

interface RouteCardProps {
  route: RouteResult;
  label: string; // "Recommended" | "Alternative 1" etc.
  isSelected: boolean;
  onPress: () => void;
}

export default function RouteCard({
  route,
  label,
  isSelected,
  onPress,
}: RouteCardProps) {
  const totalMin = Math.round(route.total_time_sec / 60);
  const co2Saved = Math.round(route.co2_saved_grams);
  const savedPct = route.carbon?.co2_saved_percent ?? 0;

  // Deduplicate mode sequence for the icons strip
  const modes = route.legs
    .map((l) => l.agency_type)
    .filter((v, i, arr) => arr[i - 1] !== v); // remove consecutive duplicates

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Label row */}
      <View style={styles.labelRow}>
        <View
          style={[styles.labelBadge, isSelected && styles.labelBadgeSelected]}
        >
          <Text
            style={[styles.labelText, isSelected && styles.labelTextSelected]}
          >
            {label}
          </Text>
        </View>
        <Text style={styles.objectiveText}>
          {route.objective === "time"
            ? "⚡ Fastest"
            : route.objective === "cost"
              ? "💰 Cheapest"
              : route.objective === "eco"
                ? "🌿 Eco"
                : ""}
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalMin}</Text>
          <Text style={styles.statLabel}>min</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            RM {route.total_fare_myr.toFixed(2)}
          </Text>
          <Text style={styles.statLabel}>fare</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, styles.statEco]}>
            -{savedPct.toFixed(0)}%
          </Text>
          <Text style={styles.statLabel}>CO₂ vs car</Text>
        </View>
      </View>

      {/* Mode icons strip */}
      <View style={styles.modeStrip}>
        {modes.map((mode, i) => (
          <React.Fragment key={i}>
            <View style={[styles.modePill, { borderColor: modeColor(mode) }]}>
              <Text style={styles.modeIcon}>{modeIcon(mode)}</Text>
            </View>
            {i < modes.length - 1 && (
              <Text style={styles.modeSeparator}>→</Text>
            )}
          </React.Fragment>
        ))}
      </View>

      {/* CO₂ saved detail */}
      <Text style={styles.co2Detail}>
        🌿 Saves {co2Saved}g CO₂ compared to driving
        {route.carbon?.equivalent_tree_days
          ? ` · ${route.carbon.equivalent_tree_days.toFixed(1)} tree-days`
          : ""}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardSelected: {
    borderColor: Colors.teal,
    backgroundColor: Colors.surfaceAlt,
    shadowColor: Colors.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  labelBadge: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  labelBadgeSelected: {
    backgroundColor: Colors.tealGlow,
    borderColor: Colors.teal,
  },
  labelText: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  labelTextSelected: {
    color: Colors.teal,
  },
  objectiveText: {
    fontSize: Typography.size.xs,
    color: Colors.textDim,
  },

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: Typography.size.xl,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  statEco: {
    color: Colors.success,
  },
  statLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textDim,
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.border,
  },

  modeStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
    flexWrap: "wrap",
  },
  modePill: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  modeIcon: { fontSize: 14 },
  modeSeparator: {
    color: Colors.textDim,
    fontSize: Typography.size.xs,
  },

  co2Detail: {
    fontSize: Typography.size.xs,
    color: Colors.success,
    lineHeight: Typography.size.xs * 1.5,
  },
});
