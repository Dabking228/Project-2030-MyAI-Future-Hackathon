import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  PanResponder,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import { useLocalSearchParams, useRouter } from "expo-router";

import RouteCard from "../components/RouteCard";
import {
  getRealtimeVehicles,
  RouteData,
  RouteResult,
  VehiclePosition,
} from "../services/api";
import {
  Colors,
  modeColor,
  Radius,
  Spacing,
  Typography,
} from "../constants/theme2";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// Bottom sheet snap positions (distance from top of screen)
const SHEET_PEEK      = SCREEN_HEIGHT * 0.86; // peek — only handle + summary visible
const SHEET_COLLAPSED = SCREEN_HEIGHT * 0.50; // default — half map, half sheet
const SHEET_HALF      = SCREEN_HEIGHT * 0.38; // more sheet
const SHEET_EXPANDED  = SCREEN_HEIGHT * 0.08; // almost full screen

// Realtime vehicle refresh interval (ms)
const VEHICLE_REFRESH_MS = 30_000;

type SnapPos = "peek" | "collapsed" | "half" | "expanded";

// ------------------------------------------------------------------ //
//  Coordinate extraction helpers                                      //
// ------------------------------------------------------------------ //

interface LatLng {
  latitude: number;
  longitude: number;
}

function stopCoordFromName(_name: string): LatLng | null {
  // In production, stop coordinates come from the legs data.
  // We derive them from the graph node data embedded in each leg.
  // For the map, we use the departure stop coords from each leg.
  return null;
}

/** Extract all polyline coordinates per mode from route legs */
function extractPolylineSegments(route: RouteResult): {
  coords: LatLng[];
  mode: string;
  isDash: boolean;
}[] {
  const segments: { coords: LatLng[]; mode: string; isDash: boolean }[] = [];

  for (const leg of route.legs) {
    const fromLat = leg.from_stop_lat;
    const fromLon = leg.from_stop_lon;
    const toLat   = leg.to_stop_lat;
    const toLon   = leg.to_stop_lon;

    if (fromLat != null && fromLon != null && toLat != null && toLon != null) {
      segments.push({
        coords: [
          { latitude: fromLat, longitude: fromLon },
          { latitude: toLat,   longitude: toLon   },
        ],
        mode: leg.agency_type,
        isDash: leg.agency_type === "walk",
      });
    }
  }
  return segments;
}

/** Extract all unique stop markers from route legs */
function extractStopMarkers(
  route: RouteResult,
): (LatLng & { name: string; mode: string })[] {
  const stops: (LatLng & { name: string; mode: string })[] = [];
  const seen = new Set<string>();

  for (const leg of route.legs) {
    const fromLat = leg.from_stop_lat;
    const fromLon = leg.from_stop_lon;
    const toLat   = leg.to_stop_lat;
    const toLon   = leg.to_stop_lon;

    if (fromLat != null && fromLon != null) {
      const key = `${fromLat},${fromLon}`;
      if (!seen.has(key)) {
        seen.add(key);
        stops.push({
          latitude: fromLat,
          longitude: fromLon,
          name: leg.from_stop_name,
          mode: leg.agency_type,
        });
      }
    }
    if (toLat != null && toLon != null) {
      const key = `${toLat},${toLon}`;
      if (!seen.has(key)) {
        seen.add(key);
        stops.push({
          latitude: toLat,
          longitude: toLon,
          name: leg.to_stop_name,
          mode: leg.agency_type,
        });
      }
    }
  }
  return stops;
}

/** Extract walk-leg start coords for walking segment indicators */
function extractWalkIndicators(
  route: RouteResult,
): (LatLng & { label: string })[] {
  return route.legs
    .filter((leg) => leg.agency_type === "walk" && leg.from_stop_lat != null)
    .map((leg) => ({
      latitude:  leg.from_stop_lat!,
      longitude: leg.from_stop_lon!,
      label: `🚶 Walk ${Math.ceil(leg.travel_time_sec / 60)} min`,
    }));
}

/** Compute a map region that fits all route stops */
function computeRegion(stops: LatLng[]): Region {
  if (stops.length === 0) {
    // Default to Kuala Lumpur
    return {
      latitude: 3.139,
      longitude: 101.6869,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  }
  const lats = stops.map((s) => s.latitude);
  const lons = stops.map((s) => s.longitude);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const minLon = Math.min(...lons),
    maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLon - minLon) * 1.4, 0.02),
  };
}

// ------------------------------------------------------------------ //
//  Tab types                                                          //
// ------------------------------------------------------------------ //

type Tab = "routes" | "steps" | "carbon";

// ------------------------------------------------------------------ //
//  Main component                                                     //
// ------------------------------------------------------------------ //

export default function RouteResultsScreen() {
  const router = useRouter();
  const { routeDataJson } = useLocalSearchParams<{ routeDataJson: string }>();

  const routeData: RouteData = useMemo(() => {
    try {
      return JSON.parse(routeDataJson ?? "{}");
    } catch {
      return {
        type: "single",
        recommended: null,
        alternatives: [],
        reasoning: "",
      };
    }
  }, [routeDataJson]);

  // Build route list: recommended first, then alternatives
  const allRoutes: RouteResult[] = useMemo(() => {
    const routes: RouteResult[] = [];
    if (routeData.recommended) routes.push(routeData.recommended);
    routes.push(...(routeData.alternatives ?? []));
    if (routeData.tspLegs?.length) routes.push(...routeData.tspLegs);
    return routes;
  }, [routeData]);

  const insets = useSafeAreaInsets();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("routes");
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const selectedRoute = allRoutes[selectedIdx] ?? null;
  const mapRef = useRef<MapView>(null);

  // Bottom sheet animation
  const sheetY = useRef(new Animated.Value(SHEET_COLLAPSED)).current;
  const sheetSnap = useRef<SnapPos>("collapsed");

  const snapSheet = useCallback(
    (target: SnapPos) => {
      sheetSnap.current = target;
      const toValue =
        target === "peek"      ? SHEET_PEEK      :
        target === "collapsed" ? SHEET_COLLAPSED :
        target === "half"      ? SHEET_HALF      :
                                 SHEET_EXPANDED;
      Animated.spring(sheetY, {
        toValue,
        useNativeDriver: false,
        tension: 60,
        friction: 10,
      }).start();
    },
    [sheetY],
  );

  // PanResponder for swipe-to-snap
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
      onPanResponderRelease: (_, gs) => {
        const { dy, vy } = gs;
        const current = sheetSnap.current;
        // Swipe DOWN (dy > 0) → go to a more-peeked snap
        if (dy > 40 || vy > 0.5) {
          if (current === "expanded") snapSheet("half");
          else if (current === "half") snapSheet("collapsed");
          else snapSheet("peek");
        }
        // Swipe UP (dy < 0) → expand more
        else if (dy < -40 || vy < -0.5) {
          if (current === "peek") snapSheet("collapsed");
          else if (current === "collapsed") snapSheet("half");
          else snapSheet("expanded");
        } else {
          // Snap back to current position
          snapSheet(current);
        }
      },
    })
  ).current;

  // Derived map data from selected route
  const polylineSegments = useMemo(
    () => (selectedRoute ? extractPolylineSegments(selectedRoute) : []),
    [selectedRoute],
  );
  const stopMarkers = useMemo(
    () => (selectedRoute ? extractStopMarkers(selectedRoute) : []),
    [selectedRoute],
  );
  const walkIndicators = useMemo(
    () => (selectedRoute ? extractWalkIndicators(selectedRoute) : []),
    [selectedRoute],
  );
  const mapRegion = useMemo(() => computeRegion(stopMarkers), [stopMarkers]);

  // Fit map to route whenever selection or map-ready state changes
  useEffect(() => {
    if (!mapReady) return;
    const coords = stopMarkers.length > 0 ? stopMarkers : null;
    if (!coords) return;
    const delay = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: {
          top: insets.top + 80,
          right: 40,
          bottom: SCREEN_HEIGHT - SHEET_COLLAPSED + 20,
          left: 40,
        },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(delay);
  }, [stopMarkers, mapReady, insets.top]);

  // Realtime vehicle polling
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function fetchVehicles() {
      try {
        const feeds = await getRealtimeVehicles();
        const all = Object.values(feeds).flat();
        setVehicles(all);
      } catch {
        /* non-fatal */
      }
    }

    fetchVehicles();
    timer = setInterval(fetchVehicles, VEHICLE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // ---------------------------------------------------------------- //
  //  Tabs                                                             //
  // ---------------------------------------------------------------- //

  const renderRoutesTab = () => (
    <FlatList
      data={allRoutes}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item, index }) => (
        <RouteCard
          route={item}
          label={index === 0 ? "Recommended" : `Alternative ${index}`}
          isSelected={selectedIdx === index}
          onPress={() => {
            setSelectedIdx(index);
            snapSheet("collapsed");
          }}
        />
      )}
      contentContainerStyle={{ paddingBottom: Spacing.xxl }}
      showsVerticalScrollIndicator={false}
    />
  );

  const renderStepsTab = () => {
    if (!selectedRoute) return null;
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {selectedRoute.instructions.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepIndexWrap}>
              <Text style={styles.stepIndex}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    );
  };

  const renderCarbonTab = () => {
    const carbon = selectedRoute?.carbon;
    if (!carbon)
      return (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyTabText}>
            No carbon data available for this route.
          </Text>
        </View>
      );

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Big saving number */}
        <View style={styles.carbonHero}>
          <Text style={styles.carbonHeroValue}>
            -{carbon.co2_saved_percent.toFixed(0)}%
          </Text>
          <Text style={styles.carbonHeroLabel}>CO₂ vs driving</Text>
          <Text style={styles.carbonHeroSub}>
            You save {Math.round(carbon.co2_saved_grams)}g of CO₂ on this trip
          </Text>
        </View>

        {/* Comparison bar */}
        <View style={styles.carbonBarSection}>
          <CarbonBar
            label="🚗 Driving"
            grams={carbon.car_baseline_co2_grams}
            maxGrams={carbon.car_baseline_co2_grams}
            color={Colors.error}
          />
          <CarbonBar
            label="🚇 This route"
            grams={carbon.total_transit_co2_grams}
            maxGrams={carbon.car_baseline_co2_grams}
            color={Colors.teal}
          />
        </View>

        {/* Breakdown */}
        <View style={styles.carbonBreakdown}>
          <Text style={styles.carbonBreakdownTitle}>Breakdown by mode</Text>
          {carbon.breakdown_by_mode.rail_co2_grams > 0 && (
            <BreakdownRow
              label="🚆 Train"
              value={`${carbon.breakdown_by_mode.rail_co2_grams.toFixed(0)}g`}
            />
          )}
          {carbon.breakdown_by_mode.bus_co2_grams > 0 && (
            <BreakdownRow
              label="🚌 Bus"
              value={`${carbon.breakdown_by_mode.bus_co2_grams.toFixed(0)}g`}
            />
          )}
          <BreakdownRow label="🚶 Walk" value="0g" />
          <BreakdownRow
            label="🌳 Tree equivalent"
            value={`${carbon.equivalent_tree_days.toFixed(1)} days`}
            isGreen
          />
        </View>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    );
  };

  // ---------------------------------------------------------------- //
  //  Render                                                           //
  // ---------------------------------------------------------------- //

  return (
    <View style={styles.container}>
      <StatusBar translucent barStyle="light-content" backgroundColor="transparent" />

      {/* Back button — respects status bar height */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 12 }]}
        onPress={() => router.back()}
      >
        <Text style={styles.backBtnText}>← Chat</Text>
      </TouchableOpacity>

      {/* Map — full bleed */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={mapRegion}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        onMapReady={() => setMapReady(true)}
      >
        {/* Transit + walking polylines */}
        {polylineSegments.map((seg, i) => (
          <Polyline
            key={`poly-${i}`}
            coordinates={seg.coords}
            strokeColor={modeColor(seg.mode)}
            strokeWidth={seg.isDash ? 2 : 4}
            lineDashPattern={seg.isDash ? [6, 6] : undefined}
          />
        ))}

        {/* Stop markers */}
        {stopMarkers.map((stop, i) => (
          <Marker
            key={`stop-${i}`}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            title={stop.name}
            tracksViewChanges={false}
          >
            <View style={[styles.stopDot, { backgroundColor: modeColor(stop.mode) }]}>
              <View style={styles.stopDotInner} />
            </View>
          </Marker>
        ))}

        {/* Walk segment indicators */}
        {walkIndicators.map((w, i) => (
          <Marker
            key={`walk-${i}`}
            coordinate={{ latitude: w.latitude, longitude: w.longitude }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.walkBadge}>
              <Text style={styles.walkBadgeText}>{w.label}</Text>
            </View>
          </Marker>
        ))}

        {/* Live vehicle positions */}
        {vehicles.map((v, i) =>
          v.lat && v.lon ? (
            <Marker
              key={`vehicle-${i}`}
              coordinate={{ latitude: v.lat, longitude: v.lon }}
              title={`Route ${v.route_id.split(":").pop()}`}
              description={v.current_status}
              tracksViewChanges={false}
            >
              <View style={styles.vehicleDot}>
                <Text style={styles.vehicleDotText}>🚌</Text>
              </View>
            </Marker>
          ) : null,
        )}
      </MapView>

      {/* Bottom Sheet */}
      <Animated.View style={[styles.sheet, { top: sheetY }]}>
        {/* Drag handle — tap cycles snaps, pan gesture swipes */}
        <TouchableOpacity
          style={styles.dragHandleArea}
          onPress={() => {
            const order: SnapPos[] = ["peek", "collapsed", "half", "expanded"];
            const idx = order.indexOf(sheetSnap.current);
            snapSheet(order[(idx + 1) % order.length]);
          }}
          activeOpacity={0.8}
          {...panResponder.panHandlers}
        >
          <View style={styles.dragHandle} />
        </TouchableOpacity>

        {/* Summary header */}
        {selectedRoute && (
          <View style={styles.sheetSummary}>
            <Text style={styles.sheetSummaryTime}>
              {Math.round(selectedRoute.total_time_sec / 60)} min
            </Text>
            <Text style={styles.sheetSummaryDot}>·</Text>
            <Text style={styles.sheetSummaryFare}>
              RM {selectedRoute.total_fare_myr.toFixed(2)}
            </Text>
            <Text style={styles.sheetSummaryDot}>·</Text>
            <Text style={styles.sheetSummaryCo2}>
              -{Math.round(selectedRoute.co2_saved_grams)}g CO₂
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabBar}>
          {(["routes", "steps", "carbon"] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => {
                setActiveTab(tab);
                snapSheet("half");
              }}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab === "routes"
                  ? "🗺 Routes"
                  : tab === "steps"
                    ? "📋 Steps"
                    : "🌿 Carbon"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        <View style={[styles.sheetContent, { paddingBottom: insets.bottom + Spacing.sm }]}>
          {activeTab === "routes" && renderRoutesTab()}
          {activeTab === "steps" && renderStepsTab()}
          {activeTab === "carbon" && renderCarbonTab()}
        </View>
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------------ //
//  Sub-components                                                     //
// ------------------------------------------------------------------ //

function CarbonBar({
  label,
  grams,
  maxGrams,
  color,
}: {
  label: string;
  grams: number;
  maxGrams: number;
  color: string;
}) {
  const pct = maxGrams > 0 ? (grams / maxGrams) * 100 : 0;
  return (
    <View style={styles.carbonBarRow}>
      <Text style={styles.carbonBarLabel}>{label}</Text>
      <View style={styles.carbonBarTrack}>
        <View
          style={[
            styles.carbonBarFill,
            { width: `${pct}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.carbonBarValue}>{Math.round(grams)}g</Text>
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  isGreen,
}: {
  label: string;
  value: string;
  isGreen?: boolean;
}) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text
        style={[styles.breakdownValue, isGreen && { color: Colors.success }]}
      >
        {value}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ //
//  Styles                                                             //
// ------------------------------------------------------------------ //

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  backBtn: {
    position: "absolute",
    // top is set dynamically via insets in JSX
    left: Spacing.md,
    zIndex: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  backBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.size.sm,
    fontWeight: "600",
  },

  // Stop markers
  stopDot: {
    width: 14,
    height: 14,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.background,
  },
  stopDotInner: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
  },
  vehicleDot: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleDotText: { fontSize: 16 },

  // Walk segment indicator badge
  walkBadge: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.walk,
  },
  walkBadgeText: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    fontWeight: "600",
  },

  // Bottom sheet
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  dragHandleArea: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
  },
  sheetSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  sheetSummaryTime: {
    fontSize: Typography.size.xl,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  sheetSummaryDot: {
    color: Colors.textDim,
    fontSize: Typography.size.lg,
  },
  sheetSummaryFare: {
    fontSize: Typography.size.lg,
    fontWeight: "600",
    color: Colors.teal,
  },
  sheetSummaryCo2: {
    fontSize: Typography.size.md,
    fontWeight: "600",
    color: Colors.success,
  },

  // Tabs
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.teal,
  },
  tabText: {
    fontSize: Typography.size.sm,
    color: Colors.textDim,
    fontWeight: "600",
  },
  tabTextActive: {
    color: Colors.teal,
  },

  // Sheet content
  sheetContent: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },

  // Steps tab
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  stepIndexWrap: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Colors.tealGlow,
    borderWidth: 1,
    borderColor: Colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepIndex: {
    fontSize: Typography.size.xs,
    color: Colors.teal,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
    lineHeight: Typography.size.md * 1.5,
  },

  // Carbon tab
  carbonHero: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  carbonHeroValue: {
    fontSize: Typography.size.hero,
    fontWeight: "800",
    color: Colors.success,
  },
  carbonHeroLabel: {
    fontSize: Typography.size.lg,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  carbonHeroSub: {
    fontSize: Typography.size.sm,
    color: Colors.textDim,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  carbonBarSection: {
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  carbonBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  carbonBarLabel: {
    width: 100,
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  carbonBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  carbonBarFill: {
    height: "100%",
    borderRadius: Radius.full,
  },
  carbonBarValue: {
    width: 42,
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    textAlign: "right",
  },
  carbonBreakdown: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  carbonBreakdownTitle: {
    fontSize: Typography.size.sm,
    color: Colors.textDim,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs + 1,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  breakdownLabel: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  breakdownValue: {
    fontSize: Typography.size.sm,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  emptyTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xxl,
  },
  emptyTabText: {
    color: Colors.textDim,
    fontSize: Typography.size.md,
  },
});

// ------------------------------------------------------------------ //
//  Google Maps dark style                                             //
// ------------------------------------------------------------------ //

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#0f172a" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#1e3a5f" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0c1628" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#1a2535" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#0f2318" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#152032" }],
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#00d4b8" }],
  },
];
