import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { uploadSnagPhoto } from '../lib/supabase';
import Icon from './Icon';

const MAX_PHOTOS = 5;
const THUMB_SIZE = 92;

interface PhotoItem {
  id: string;
  uri: string;
  uploadTask: Promise<string | null>;
  isUploading: boolean;
}

export interface PhotoPickerHandle {
  /** Resolves the uploaded photo paths, awaiting any in-flight uploads. Skips any that failed to upload. */
  getPhotoUrls: () => Promise<string[]>;
  reset: () => void;
}

interface Props {
  /** Storage paths are scoped by org (required by the bucket's RLS policy), so uploads wait until this is known. */
  orgId: string | null;
  onUploadingChange?: (uploading: boolean) => void;
  onPhotosChange?: (count: number) => void;
}

const PhotoPicker = forwardRef<PhotoPickerHandle, Props>(({ orgId, onUploadingChange, onPhotosChange }, ref) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  useEffect(() => {
    onPhotosChange?.(photos.length);
  }, [photos.length, onPhotosChange]);

  function setUploading(id: string, isUploading: boolean) {
    setPhotos((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, isUploading } : p));
      onUploadingChange?.(next.some((p) => p.isUploading));
      return next;
    });
  }

  async function addPhoto(uri: string) {
    if (!orgId) return;
    const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const fileName = `${orgId}/${id}.jpg`;

    const task = (async () => {
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      return uploadSnagPhoto(compressed.uri, fileName);
    })().finally(() => setUploading(id, false));

    setPhotos((prev) => {
      const next = [...prev, { id, uri, uploadTask: task, isUploading: true }];
      onUploadingChange?.(true);
      return next;
    });
  }

  function offerSource() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      addPhoto(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      addPhoto(result.assets[0].uri);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      onUploadingChange?.(next.some((p) => p.isUploading));
      return next;
    });
  }

  useImperativeHandle(ref, () => ({
    getPhotoUrls: async () => {
      const paths = await Promise.all(photos.map((p) => p.uploadTask));
      return paths.filter((p): p is string => Boolean(p));
    },
    reset: () => setPhotos([]),
  }));

  if (photos.length === 0) {
    return (
      <View style={styles.area}>
        <Icon name="camera-outline" size="xl" color={Colors.textSecondary} />
        <Text style={styles.label}>Add up to {MAX_PHOTOS} photos</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={takePhoto} activeOpacity={0.7} disabled={!orgId}>
            <Text style={styles.buttonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={pickFromLibrary} activeOpacity={0.7} disabled={!orgId}>
            <Text style={styles.buttonText}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
      {photos.map((photo) => (
        <View key={photo.id} style={styles.thumbWrap}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
          {photo.isUploading && (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator color={Colors.white} size="small" />
            </View>
          )}
          <TouchableOpacity style={styles.removeButton} onPress={() => removePhoto(photo.id)} hitSlop={8}>
            <Icon name="close" size="sm" color={Colors.white} />
          </TouchableOpacity>
        </View>
      ))}
      {photos.length < MAX_PHOTOS && (
        <TouchableOpacity style={styles.addTile} onPress={offerSource} activeOpacity={0.7}>
          <Icon name="add" size="lg" color={Colors.textSecondary} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
});

export default PhotoPicker;

const styles = StyleSheet.create({
  area: {
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: Spacing.md,
  },
  label: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    width: '100%',
  },
  button: {
    flex: 1,
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  buttonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  thumbRow: {
    gap: Spacing.sm,
  },
  thumbWrap: {
    position: 'relative',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
