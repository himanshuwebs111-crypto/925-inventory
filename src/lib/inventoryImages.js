// src/lib/inventoryImages.js

import { supabase } from "./supabaseClient";

const BUCKET_NAME = "inventory-images";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getFileExtension(file) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return extensions[file.type] || "jpg";
}

function getSafeId(value) {
  return String(value).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
}

function getStoragePath(itemId, file) {
  const extension = getFileExtension(file);
  const safeId = getSafeId(itemId);

  const uniqueId =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  return `products/${safeId}-${uniqueId}.${extension}`;
}

export function validateInventoryImage(file) {
  if (!file) {
    return "";
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Please upload a JPG, PNG, or WebP image.";
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return "Image must be 5 MB or smaller.";
  }

  return "";
}

export async function uploadInventoryImage(
  itemId,
  file,
) {
  const validationError =
    validateInventoryImage(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const path = getStoragePath(
    itemId,
    file,
  );

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(
      error.message ||
        "Unable to upload the product image.",
    );
  }

  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error(
      "Image uploaded, but its URL could not be created.",
    );
  }

  return {
    imagePath: path,
    imageUrl: data.publicUrl,
  };
}

export async function deleteInventoryImage(
  imagePath,
) {
  if (!imagePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([imagePath]);

  if (error) {
    throw new Error(
      error.message ||
        "Unable to delete the product image.",
    );
  }
}