import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  ImageManipulator,
  SaveFormat,
} from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {
  MAX_IMAGES,
  normalizePickedImages,
  resizeActionFor,
  type PickedImage,
  type PreparedDocument,
  type PreparedImage,
} from './coach-files';

async function compressImage(image: PreparedImage): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(image.uri);
  const resize = resizeActionFor(image.width, image.height, 1600);
  if (resize.width || resize.height) context.resize(resize);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return {
    ...image,
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    fileName: 'resume.jpg',
    mediaType: 'image/jpeg',
  };
}

export async function pickImages(
  source: 'camera' | 'library'
): Promise<PreparedImage[]> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('permission-denied');

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: MAX_IMAGES,
          quality: 1,
        });
  if (result.canceled) return [];

  const picked: PickedImage[] = result.assets.map((asset, index) => ({
    uri: asset.uri,
    fileName: asset.fileName || `resume-${index}.jpg`,
    width: asset.width,
    height: asset.height,
    size: asset.fileSize,
  }));
  const normalized = await normalizePickedImages(picked);
  return Promise.all(normalized.map(compressImage));
}

export async function pickDocuments(): Promise<PreparedDocument[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    file: asset.file,
  }));
}

export async function deletePreparedFiles(
  files: Array<{ uri: string }>
): Promise<void> {
  for (const item of files) {
    try {
      new File(item.uri).delete();
    } catch {
      // best-effort cleanup only
    }
  }
}
