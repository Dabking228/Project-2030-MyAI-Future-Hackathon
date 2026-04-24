import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from "react-native";
import { Colors, Radius, Spacing, Typography } from "../constants/theme2";

export type MessageRole = "user" | "assistant" | "loading";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  hasRoute?: boolean; // Whether this message has attached route data
}

interface ChatBubbleProps {
  message: ChatMessage;
  onViewRoute?: () => void;
}

// Loading indicator

function LoadingDots() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 320,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.loadingRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: dot,
              transform: [
                {
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

// Simple Markdown-lite renderer

function renderContent(text: string) {
  // Split on **bold** markers and render accordingly
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={i} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}

// Main component

export default function ChatBubble({ message, onViewRoute }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isLoading = message.role === "loading";

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAgent]}>
      {/* Avatar dot for agent */}
      {!isUser && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>M</Text>
        </View>
      )}

      <View style={styles.bubbleColumn}>
        <View
          style={[
            styles.bubble,
            isUser
              ? styles.bubbleUser
              : isLoading
                ? styles.bubbleLoading
                : styles.bubbleAgent,
          ]}
        >
          {isLoading ? (
            <LoadingDots />
          ) : (
            <Text
              style={[styles.text, isUser ? styles.textUser : styles.textAgent]}
            >
              {renderContent(message.content)}
            </Text>
          )}
        </View>

        {/* "View Route" action button for messages with route data */}
        {message.hasRoute && !isLoading && (
          <TouchableOpacity
            style={styles.viewRouteBtn}
            onPress={onViewRoute}
            activeOpacity={0.75}
          >
            <Text style={styles.viewRouteBtnText}>View Route Map →</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.timestamp, isUser && styles.timestampUser]}>
          {message.timestamp.toLocaleTimeString("en-MY", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    alignItems: "flex-end",
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  rowAgent: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    backgroundColor: Colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
    marginBottom: 4,
  },
  avatarText: {
    color: Colors.background,
    fontSize: Typography.size.sm,
    fontWeight: "700",
  },
  bubbleColumn: {
    maxWidth: "78%",
    alignItems: "flex-start",
  },
  bubble: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  bubbleUser: {
    backgroundColor: Colors.bubbleUser,
    borderBottomRightRadius: Radius.sm,
  },
  bubbleAgent: {
    backgroundColor: Colors.bubbleAgent,
    borderBottomLeftRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleLoading: {
    backgroundColor: Colors.bubbleAgent,
    borderBottomLeftRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  text: {
    fontSize: Typography.size.md,
    lineHeight: Typography.size.md * 1.55,
  },
  textUser: {
    color: Colors.bubbleUserText,
    fontWeight: "500",
  },
  textAgent: {
    color: Colors.bubbleAgentText,
  },
  bold: {
    fontWeight: "700",
    color: Colors.teal,
  },
  timestamp: {
    fontSize: Typography.size.xs,
    color: Colors.textDim,
    marginTop: 3,
    marginLeft: 4,
  },
  timestampUser: {
    alignSelf: "flex-end",
    marginRight: 4,
  },
  viewRouteBtn: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    backgroundColor: Colors.tealGlow,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.teal,
  },
  viewRouteBtnText: {
    color: Colors.teal,
    fontSize: Typography.size.sm,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.teal,
  },
});
