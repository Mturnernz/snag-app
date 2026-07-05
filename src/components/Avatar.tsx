import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

interface Props {
  uri?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  /** Highlights the avatar as "you" (e.g. the current user's row in a roster/leaderboard). */
  ring?: boolean;
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || '';
  if (!source) return '?';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function Avatar({ uri, name, email, size = 40, ring = false }: Props) {
  const initials = getInitials(name, email);
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View
      style={[
        dimension,
        styles.container,
        ring && { borderWidth: 2, borderColor: Colors.primary },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={[dimension, styles.image]} />
      ) : (
        <View style={[dimension, styles.fallback]}>
          <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initials}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'cover',
  },
  fallback: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: Colors.primary,
    fontWeight: '700',
  },
});
