import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { cloudinaryReady, getCloudinary } from "../../shared/cloudinary";
import { AppError } from "../../shared/errors/AppError";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

export const mediaRouter = Router();

mediaRouter.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!cloudinaryReady()) {
        throw new AppError(
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET.",
          503,
          "CLOUDINARY_MISSING",
        );
      }
      if (!req.file) throw new AppError("file required", 400, "INVALID");

      const mime = (req.file.mimetype || "").toLowerCase();
      const name = (req.file.originalname || "").toLowerCase();
      const imageExt =
        /\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tif|tiff|jfif|raw|dng)$/i.test(name);
      const videoExt = /\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg|3gp|qt)$/i.test(name);
      const audioExt = /\.(webm|ogg|mp3|m4a|wav|aac|opus)$/i.test(name);

      const kindHint = String(req.body?.kind || "").toUpperCase();
      const isVideo =
        kindHint === "VIDEO" ||
        mime.startsWith("video/") ||
        (videoExt && !mime.startsWith("image/") && !mime.startsWith("audio/"));
      const isAudio =
        kindHint === "VOICE" ||
        mime.startsWith("audio/") ||
        ((mime === "application/octet-stream" || !mime) && audioExt && !isVideo);
      const isImage =
        kindHint === "IMAGE" ||
        mime.startsWith("image/") ||
        imageExt ||
        (!isVideo && !isAudio && Boolean(req.file.buffer?.length));

      if (!isVideo && !isAudio && !isImage) {
        throw new AppError(
          "Unsupported file. Send an image, video (≤30s), or voice note.",
          400,
          "UNSUPPORTED_MEDIA",
        );
      }

      // "auto" handles MOV/QuickTime and odd mime types more reliably than forcing video/image.
      const resourceType = isAudio ? "video" : isVideo ? "auto" : isImage ? "image" : "auto";

      const clientDuration = Number(req.body?.durationS);
      const result = await new Promise<{ secure_url: string; duration?: number }>(
        (resolve, reject) => {
          const stream = getCloudinary().uploader.upload_stream(
            {
              folder: "callme2serve",
              resource_type: resourceType,
              chunk_size: 6_000_000,
              timeout: 120_000,
              ...(isVideo
                ? {
                    // Auto-compress for chat UX: 720p cap + lower bitrate.
                    transformation: [
                      { width: 720, crop: "limit", quality: "auto:eco", bit_rate: "750k" },
                    ],
                    eager: [
                      {
                        width: 720,
                        crop: "limit",
                        quality: "auto:eco",
                        bit_rate: "750k",
                        format: "mp4",
                      },
                    ],
                    eager_async: false,
                  }
                : isImage
                  ? {
                      transformation: [
                        { width: 1600, crop: "limit", quality: "auto:good" },
                      ],
                    }
                  : {}),
            },
            (err, uploaded) => {
              if (err || !uploaded) {
                const msg =
                  err && typeof err === "object" && "message" in err
                    ? String((err as { message?: string }).message)
                    : "Cloudinary rejected the file. Try MP4/WebM under 30s.";
                reject(new AppError(msg, 400, "UPLOAD_FAILED"));
                return;
              }
              const eagerUrl =
                Array.isArray(uploaded.eager) && uploaded.eager[0]?.secure_url
                  ? String(uploaded.eager[0].secure_url)
                  : undefined;
              resolve({
                secure_url: eagerUrl || uploaded.secure_url,
                duration: uploaded.duration,
              });
            },
          );
          stream.end(req.file!.buffer);
        },
      );

      const cloudDuration =
        typeof result.duration === "number" && Number.isFinite(result.duration) && result.duration > 0
          ? result.duration
          : undefined;
      const clientOk =
        Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : undefined;
      const durationS = cloudDuration ?? clientOk;

      // Only enforce cap when we have a finite duration (some browsers report Infinity).
      if (isVideo && typeof durationS === "number" && durationS > 30.05) {
        throw new AppError("Video stops at 30 seconds", 400, "VIDEO_CAP");
      }

      res.status(201).json({
        success: true,
        message: "Uploaded",
        data: {
          url: result.secure_url,
          durationS,
          kind: isVideo ? "VIDEO" : isAudio ? "VOICE" : "IMAGE",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
