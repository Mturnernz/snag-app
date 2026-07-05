import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { uploadIssuePhoto } from '../lib/supabase';
import Icon from './Icon';

export interface PhotoPickerHandle {
  /** Resolves the uploaded photo URL, awaiting any in-flight upload. Returns null if no photo was picked. */
  getPhotoUrl: () => Promise<string | null>;
  reset: () => void;
}

interface Props {
  onUploadingChange?: (uploading: boolean) => void;
}

const PhotoPicker = forwardRef<PhotoPickerHandle, Props>(({ onUploadingChange }, ref) => {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadTask, setUploadTask] = useState<Promise<string | null> | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function compressAndUpload(uri: string) {
    const fileName = `${Date.now()}.jpg`;
    setIsUploading(true);
    onUploadingChange?.(true);
    const compressed = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    const task = uploadIssuePhoto(compressed.uri, fileName).finally(() => {
      setIsUploading(false);
      onUploadingChange?.(false);
    });
    setUploadTask(task);
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
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      compressAndUpload(uri);
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
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      compressAndUpload(uri);
    }
  }

  function removePhoto() {
    setPhotoUri(null);
    setUploadTask(null);
    setIsUploading(false);
    onUploadingChange?.(false);
  }

  useImperativeHandle(ref, () => ({
    getPhotoUrl: async () => {
      if (!photoUri) return null;
      if (uploadTask) return uploadTask;
      return uploadIssuePhoto(photoUri, `${Date.now()}.jpg`);
    },
    reset: removePhoto,
  }));

  if (photoUri) {
    return (
      <View style={styles.previewContainer}>
        <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" cachePolicy="memory-disk" />
        {isUploading && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator color={Colors.white} size="small" />
            <Text style={styles.uploadingText}>Uploading…</Text>
          </View>
        )}
        <TouchableOpacity style={styles.removeButton} onPress={removePhoto} hitSlop={8}>
          <Icon name="close" size="sm" color={Colors.white} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.area}>
      <Icon name="camera-outline" size="xl" color={Colors.textSecondary} />
      <Text style={styles.label}>Add a photo</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={takePhoto} activeOpacity={0.7}>
          <Text style={styles.buttonText}>Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={pickFromLibrary} activeOpacity={0.7}>
          <Text style={styles.buttonText}>Choose from Library</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  previewContainer: {
    position: 'relative',
    borderRadius: Radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  preview: {
    width: '100%',
    height: 220,
  },
  uploadingOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  uploadingText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
