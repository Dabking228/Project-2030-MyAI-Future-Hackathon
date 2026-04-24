import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Keyboard,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useRouter } from "expo-router";

import ChatBubble, { ChatMessage } from "../../components/ChatBubble";
import { sendChatMessage, RouteData } from "../../services/api";
import { Colors, Radius, Spacing, Typography } from "../../constants/theme2";

// Welcome suggestions
const SUGGESTIONS = [
  "Fastest route from KL Sentral to KLCC",
  "Cheapest way from Bangsar to Batu Caves",
  "Eco-friendly route: Mid Valley to Bukit Bintang",
  "Visit KLCC, Petaling Street & Central Market today",
];

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [locationText, setLocationText] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  // Conversation history sent to Genkit for context
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    [],
  );

  // Latest routeData — stored for navigation
  const pendingRouteRef = useRef<RouteData | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    }
  }, [messages]);

  // Location
  const injectLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        alert("Location permission is required to auto-detect your position.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;

      // Reverse geocode for a human-readable name
      const [place] = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      const label = place
        ? [place.name, place.street, place.district, place.city]
            .filter(Boolean)
            .slice(0, 2)
            .join(", ")
        : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      setLocationText(label);
      // Append to input text naturally
      setInputText((prev) =>
        prev.trim() ? `${prev.trim()} from ${label}` : `From ${label}, `,
      );
    } catch {
      alert("Could not get your location. Please try again.");
    } finally {
      setLocationLoading(false);
    }
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      Keyboard.dismiss();
      setInputText("");
      setLocationText(null);

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };

      const loadingMsg: ChatMessage = {
        id: "loading",
        role: "loading",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setIsLoading(true);

      try {
        const response = await sendChatMessage(trimmed, historyRef.current);

        // Store route data for the "View Route" button
        if (response.routeData) {
          pendingRouteRef.current = response.routeData;
        }

        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          role: "assistant",
          content: response.text,
          timestamp: new Date(),
          hasRoute: !!response.routeData,
        };

        // Update conversation history
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: trimmed },
          { role: "assistant" as const, content: response.text },
        ].slice(-20); // Keep last 10 turns (20 messages)

        setMessages((prev) => [
          ...prev.filter((m) => m.id !== "loading"),
          agentMsg,
        ]);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Sorry, I couldn't reach the server. Please check your connection and try again.\n\n_${err?.message ?? "Unknown error"}_`,
          timestamp: new Date(),
        };
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== "loading"),
          errMsg,
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading],
  );

  // Navigate to route results
  const handleViewRoute = useCallback(
    (routeData: RouteData) => {
      router.push({
        pathname: "/RouteResultsScreen",
        params: { routeDataJson: JSON.stringify(routeData) },
      });
    },
    [router],
  );

  // Welcome screen (empty state)
  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>🚇</Text>
      <Text style={styles.emptyTitle}>SYBAR_AI</Text>
      <Text style={styles.emptySubtitle}>
        Ask me anything about public transport in Malaysia.
      </Text>
      <View style={styles.suggestionsGrid}>
        {SUGGESTIONS.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={styles.suggestionChip}
            onPress={() => sendMessage(s)}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionText}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>SYBAR_AI</Text>
        </View>
        <Text style={styles.headerSub}>Malaysia Transit AI</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + (Platform.OS === "ios" ? 54 : 0)}
      >
        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            // Find the route data for this specific message
            const routeData =
              item.hasRoute && item.id.startsWith("agent-")
                ? pendingRouteRef.current
                : null;

            return (
              <ChatBubble
                message={item}
                onViewRoute={
                  routeData ? () => handleViewRoute(routeData) : undefined
                }
              />
            );
          }}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={
            messages.length === 0 ? styles.emptyContainer : styles.listContent
          }
          showsVerticalScrollIndicator={false}
        />

        {/* Location badge */}
        {locationText && (
          <View style={styles.locationBadge}>
            <Text style={styles.locationBadgeIcon}>📍</Text>
            <Text style={styles.locationBadgeText} numberOfLines={1}>
              {locationText}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setLocationText(null);
              }}
            >
              <Text style={styles.locationBadgeClear}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input row */}
        <View style={[styles.inputRow, { paddingBottom: insets.bottom || Spacing.sm }]}>
          {/* Location button */}
          <TouchableOpacity
            style={styles.locationBtn}
            onPress={injectLocation}
            disabled={locationLoading}
            activeOpacity={0.7}
          >
            {locationLoading ? (
              <ActivityIndicator size="small" color={Colors.teal} />
            ) : (
              <Text style={styles.locationBtnIcon}>📍</Text>
            )}
          </TouchableOpacity>

          {/* Text input */}
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask about a route…"
            placeholderTextColor={Colors.textDim}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(inputText)}
            blurOnSubmit={false}
          />

          {/* Send button */}
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!inputText.trim() || isLoading) && styles.sendBtnDisabled,
            ]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.background} />
            ) : (
              <Text style={styles.sendBtnIcon}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Styles
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  headerDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.teal,
    shadowColor: Colors.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  headerTitle: {
    fontSize: Typography.size.lg,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: Typography.size.xs,
    color: Colors.textDim,
  },

  // List
  listContent: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: Typography.size.xxl,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: Typography.size.md * 1.6,
    marginBottom: Spacing.xl,
  },
  suggestionsGrid: {
    width: "100%",
    gap: Spacing.sm,
  },
  suggestionChip: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  suggestionText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: Typography.size.sm * 1.5,
  },

  // Location badge
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.tealGlow,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.teal,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  locationBadgeIcon: { fontSize: 13 },
  locationBadgeText: {
    flex: 1,
    color: Colors.teal,
    fontSize: Typography.size.sm,
  },
  locationBadgeClear: {
    color: Colors.teal,
    fontSize: Typography.size.sm,
    fontWeight: "600",
  },

  // Input row
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm, // overridden inline with insets.bottom
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  locationBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  locationBtnIcon: { fontSize: 18 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: Typography.size.md,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.teal,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.teal,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.surfaceAlt,
    shadowOpacity: 0,
    elevation: 0,
  },
  sendBtnIcon: {
    color: Colors.background,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },
});
