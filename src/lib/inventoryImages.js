// src/lib/inventoryImages.js

import { supabase } from "./supabaseClient";

const BUCKET_NAME = "inventory-images";

const MAX_ORIGINAL_IMAGE_SIZE =
  25 * 1024 * 1024;

const INITIAL_MAX_IMAGE_DIMENSION = 1600;

const MIN_IMAGE_DIMENSION = 800;

const TARGET_COMPRESSED_SIZE =
  1.2 * 1024 * 1024;

const MAX_COMPRESSED_SIZE =
  1.5 * 1024 * 1024;

const INITIAL_WEBP_QUALITY = 0.82;

const MIN_WEBP_QUALITY = 0.55;

const QUALITY_STEP = 0.07;

const DIMENSION_SCALE_STEP = 0.85;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getSafeId(value) {
  return String(value).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
}

function getStoragePath(itemId) {
  const safeId = getSafeId(itemId);

  const uniqueId =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  return `products/${safeId}-${uniqueId}.webp`;
}

export function validateInventoryImage(file) {
  if (!file) {
    return "";
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Please upload a JPG, PNG, or WebP image.";
  }

  if (file.size > MAX_ORIGINAL_IMAGE_SIZE) {
    return "Image must be 25 MB or smaller.";
  }

  return "";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl =
      URL.createObjectURL(file);

    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);

      reject(
        new Error(
          "Unable to read the selected image.",
        ),
      );
    };

    image.src = objectUrl;
  });
}

function getResizedDimensions(
  width,
  height,
  maxDimension,
) {
  const largestDimension = Math.max(
    width,
    height,
  );

  if (
    largestDimension <=
    maxDimension
  ) {
    return {
      width,
      height,
    };
  }

  const scale =
    maxDimension /
    largestDimension;

  return {
    width: Math.max(
      1,
      Math.round(width * scale),
    ),
    height: Math.max(
      1,
      Math.round(height * scale),
    ),
  };
}

function canvasToWebp(
  canvas,
  quality,
) {
  return new Promise(
    (resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(
              new Error(
                "Unable to compress the selected image.",
              ),
            );
            return;
          }

          resolve(blob);
        },
        "image/webp",
        quality,
      );
    },
  );
}

async function compressAtSettings(
  image,
  maxDimension,
  quality,
) {
  const dimensions =
    getResizedDimensions(
      image.naturalWidth,
      image.naturalHeight,
      maxDimension,
    );

  const canvas =
    document.createElement(
      "canvas",
    );

  canvas.width =
    dimensions.width;

  canvas.height =
    dimensions.height;

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Unable to prepare the image for upload.",
    );
  }

  context.imageSmoothingEnabled =
    true;

  context.imageSmoothingQuality =
    "high";

  context.drawImage(
    image,
    0,
    0,
    dimensions.width,
    dimensions.height,
  );

  const blob =
    await canvasToWebp(
      canvas,
      quality,
    );

  return {
    blob,
    width:
      dimensions.width,
    height:
      dimensions.height,
  };
}

async function compressInventoryImage(
  file,
) {
  const image =
    await loadImage(file);

  let maxDimension =
    INITIAL_MAX_IMAGE_DIMENSION;

  let quality =
    INITIAL_WEBP_QUALITY;

  let bestResult = null;

  while (true) {
    const result =
      await compressAtSettings(
        image,
        maxDimension,
        quality,
      );

    bestResult = result;

    if (
      result.blob.size <=
      TARGET_COMPRESSED_SIZE
    ) {
      break;
    }

    if (
      quality >
      MIN_WEBP_QUALITY
    ) {
      quality = Math.max(
        MIN_WEBP_QUALITY,
        quality - QUALITY_STEP,
      );

      continue;
    }

    if (
      maxDimension >
      MIN_IMAGE_DIMENSION
    ) {
      maxDimension = Math.max(
        MIN_IMAGE_DIMENSION,
        Math.round(
          maxDimension *
            DIMENSION_SCALE_STEP,
        ),
      );

      quality =
        INITIAL_WEBP_QUALITY;

      continue;
    }

    break;
  }

  if (
    bestResult.blob.size >
    MAX_COMPRESSED_SIZE
  ) {
    let emergencyQuality =
      MIN_WEBP_QUALITY;

    let emergencyDimension =
      Math.min(
        maxDimension,
        MIN_IMAGE_DIMENSION,
      );

    while (
      bestResult.blob.size >
        MAX_COMPRESSED_SIZE &&
      emergencyQuality >= 0.4
    ) {
      const result =
        await compressAtSettings(
          image,
          emergencyDimension,
          emergencyQuality,
        );

      bestResult = result;

      if (
        result.blob.size <=
        MAX_COMPRESSED_SIZE
      ) {
        break;
      }

      emergencyQuality -=
        0.05;

      if (
        emergencyQuality <
        0.4
      ) {
        break;
      }
    }
  }

  if (
    bestResult.blob.size >
    MAX_COMPRESSED_SIZE
  ) {
    throw new Error(
      "The image could not be compressed enough for upload. Please choose a smaller image.",
    );
  }

  return new File(
    [bestResult.blob],
    "product-image.webp",
    {
      type: "image/webp",
      lastModified:
        Date.now(),
    },
  );
}

export async function uploadInventoryImage(
  itemId,
  file,
) {
  const validationError =
    validateInventoryImage(file);

  if (validationError) {
    throw new Error(
      validationError,
    );
  }

  const compressedFile =
    await compressInventoryImage(
      file,
    );

  const path =
    getStoragePath(itemId);

  const { error } =
    await supabase.storage
      .from(BUCKET_NAME)
      .upload(
        path,
        compressedFile,
        {
          cacheControl: "3600",
          contentType:
            "image/webp",
          upsert: false,
        },
      );

  if (error) {
    throw new Error(
      error.message ||
        "Unable to upload the product image.",
    );
  }

  const { data } =
    supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(path);

  if (!data?.publicUrl) {
    try {
      await deleteInventoryImage(
        path,
      );
    } catch (cleanupError) {
      console.error(
        "Unable to clean up uploaded image:",
        cleanupError,
      );
    }

    throw new Error(
      "Image uploaded, but its URL could not be created.",
    );
  }

  return {
    imagePath: path,
    imageUrl:
      data.publicUrl,
  };
}

export async function deleteInventoryImage(
  imagePath,
) {
  if (!imagePath) {
    return;
  }

  const { error } =
    await supabase.storage
      .from(BUCKET_NAME)
      .remove([imagePath]);

  if (error) {
    throw new Error(
      error.message ||
        "Unable to delete the product image.",
    );
  }
}