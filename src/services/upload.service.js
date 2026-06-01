const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const config = require("../config/config");

const SHARE_WITH = {
  USER_IDS: "userids",
  WHO_HAVE_LINK: "whohavelink",
  OWN: "own",
};

class UploadService {
  constructor(db) {
    this.db = db;
    this.chunkSizeBytes = config.upload.chunkSizeBytes;
    this.maxFileSizeBytes = config.upload.maxFileSizeBytes;
    this.tmpRootDir = path.resolve(process.cwd(), config.upload.tmpDir);
    this.targetRootDir = path.resolve(process.cwd(), config.upload.targetDir);
  }

  static getAuthUserId(auth = {}) {
    const raw = auth?.user?.id ?? auth?.user?.user_id ?? null;
    const userId = Number(raw);

    if (!Number.isFinite(userId) || userId <= 0) {
      return null;
    }

    return Math.floor(userId);
  }

  static normalizeShareWith(value) {
    const normalized = String(value || SHARE_WITH.OWN).trim().toLowerCase();

    if (Object.values(SHARE_WITH).includes(normalized)) {
      return normalized;
    }

    const err = new Error("Invalid shareWith");
    err.code = "INVALID_UPLOAD_SHARE_WITH";
    err.status = 400;
    throw err;
  }

  static sanitizeFileName(name) {
    const baseName = path.basename(String(name || "file"));
    return baseName.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  }

  static validateUploadId(uploadId) {
    const normalized = String(uploadId || "").trim();

    if (!/^[0-9a-fA-F-]{36}$/.test(normalized)) {
      const err = new Error("Invalid upload id");
      err.code = "INVALID_UPLOAD_ID";
      err.status = 400;
      throw err;
    }

    return normalized;
  }

  static formatDateYmd(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  getMetaPath(uploadId) {
    return path.join(this.tmpRootDir, uploadId, "meta.json");
  }

  getPartPath(uploadId, partNumber) {
    const safePart = String(Number(partNumber)).padStart(6, "0");
    return path.join(this.tmpRootDir, uploadId, `${safePart}.part`);
  }

  async readMeta(uploadId) {
    const metaPath = this.getMetaPath(uploadId);

    let raw;

    try {
      raw = await fs.readFile(metaPath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        const notFound = new Error("Upload session not found");
        notFound.code = "UPLOAD_SESSION_NOT_FOUND";
        notFound.status = 404;
        throw notFound;
      }

      throw err;
    }

    let meta;

    try {
      meta = JSON.parse(raw);
    } catch (_err) {
      const invalid = new Error("Invalid upload metadata");
      invalid.code = "UPLOAD_META_INVALID";
      invalid.status = 500;
      throw invalid;
    }

    return meta;
  }

  assertAuthorizedUploadOwner(meta, auth = {}) {
    const authUserId = UploadService.getAuthUserId(auth);

    if (!authUserId) {
      const err = new Error("Provider token is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    if (Number(meta.userId) !== Number(authUserId)) {
      const err = new Error("Upload session owner mismatch");
      err.code = "UPLOAD_PERMISSION_DENIED";
      err.status = 403;
      throw err;
    }

    return authUserId;
  }

  async initiateUpload(payload = {}, options = {}) {
    const authUserId = UploadService.getAuthUserId(options.auth);

    if (!authUserId) {
      const err = new Error("Provider token is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    const fileName = UploadService.sanitizeFileName(payload.fileName || payload.filename);
    const fileSize = Number(payload.fileSize ?? payload.filesize ?? 0);

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      const err = new Error("fileSize must be a positive number");
      err.code = "INVALID_UPLOAD_FILE_SIZE";
      err.status = 400;
      throw err;
    }

    if (fileSize > this.maxFileSizeBytes) {
      const err = new Error(`File is too large. Max ${this.maxFileSizeBytes} bytes`);
      err.code = "UPLOAD_FILE_TOO_LARGE";
      err.status = 400;
      throw err;
    }

    const computedTotalParts = Math.ceil(fileSize / this.chunkSizeBytes);
    const requestedTotalParts = Number(payload.totalParts || payload.total_part_number || 0);
    const totalParts = Number.isFinite(requestedTotalParts) && requestedTotalParts > 0
      ? Math.floor(requestedTotalParts)
      : computedTotalParts;

    if (totalParts !== computedTotalParts) {
      const err = new Error("totalParts does not match file size and chunk configuration");
      err.code = "INVALID_UPLOAD_TOTAL_PARTS";
      err.status = 400;
      throw err;
    }

    const shareWith = UploadService.normalizeShareWith(payload.shareWith || payload.sharewith);
    const uploadId = randomUUID();
    const uploadDir = path.join(this.tmpRootDir, uploadId);

    await fs.mkdir(uploadDir, { recursive: true });

    const meta = {
      uploadId,
      userId: authUserId,
      fileName,
      fileSize,
      mimeType: String(payload.mimeType || payload.mimetype || "application/octet-stream"),
      totalParts,
      shareWith,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(this.getMetaPath(uploadId), JSON.stringify(meta, null, 2), "utf8");

    return {
      uploadId,
      fileName,
      fileSize,
      totalParts,
      chunkSizeBytes: this.chunkSizeBytes,
      maxFileSizeBytes: this.maxFileSizeBytes,
      shareWith,
    };
  }

  async uploadPart(uploadIdInput, payload = {}, options = {}) {
    const uploadId = UploadService.validateUploadId(uploadIdInput);
    const meta = await this.readMeta(uploadId);

    this.assertAuthorizedUploadOwner(meta, options.auth);

    const partNumber = Number(payload.partNumber ?? payload.part ?? 0);

    if (!Number.isFinite(partNumber) || partNumber <= 0 || partNumber > Number(meta.totalParts)) {
      const err = new Error("Invalid partNumber");
      err.code = "INVALID_UPLOAD_PART_NUMBER";
      err.status = 400;
      throw err;
    }

    const incomingTotal = Number(payload.totalParts ?? payload.total_part_number ?? 0);
    if (Number.isFinite(incomingTotal) && incomingTotal > 0 && incomingTotal !== Number(meta.totalParts)) {
      const err = new Error("totalParts mismatch");
      err.code = "INVALID_UPLOAD_TOTAL_PARTS";
      err.status = 400;
      throw err;
    }

    const chunkBase64 = String(payload.chunkBase64 ?? payload.base64 ?? "").trim();

    if (!chunkBase64) {
      const err = new Error("chunkBase64 is required");
      err.code = "UPLOAD_CHUNK_REQUIRED";
      err.status = 400;
      throw err;
    }

    let chunkBuffer;

    try {
      chunkBuffer = Buffer.from(chunkBase64, "base64");
    } catch (_err) {
      const err = new Error("chunkBase64 must be valid base64");
      err.code = "INVALID_UPLOAD_CHUNK_BASE64";
      err.status = 400;
      throw err;
    }

    if (!chunkBuffer || chunkBuffer.length === 0) {
      const err = new Error("chunkBase64 is empty");
      err.code = "UPLOAD_CHUNK_EMPTY";
      err.status = 400;
      throw err;
    }

    if (chunkBuffer.length > this.chunkSizeBytes) {
      const err = new Error(`Chunk size exceeds ${this.chunkSizeBytes} bytes`);
      err.code = "UPLOAD_CHUNK_TOO_LARGE";
      err.status = 400;
      throw err;
    }

    await fs.writeFile(this.getPartPath(uploadId, partNumber), chunkBuffer);

    const files = await fs.readdir(path.join(this.tmpRootDir, uploadId));
    const uploadedParts = files.filter((name) => /\.part$/i.test(name)).length;
    const percentage = Math.min(100, Math.round((uploadedParts / Number(meta.totalParts)) * 100));

    return {
      uploadId,
      partNumber,
      uploadedParts,
      totalParts: Number(meta.totalParts),
      percentage,
    };
  }

  async completeUpload(uploadIdInput, payload = {}, options = {}) {
    const uploadId = UploadService.validateUploadId(uploadIdInput);
    const meta = await this.readMeta(uploadId);
    const authUserId = this.assertAuthorizedUploadOwner(meta, options.auth);
    const shareWith = UploadService.normalizeShareWith(payload.shareWith || payload.sharewith || meta.shareWith);

    for (let i = 1; i <= Number(meta.totalParts); i += 1) {
      try {
        await fs.access(this.getPartPath(uploadId, i));
      } catch (_err) {
        const err = new Error(`Missing file chunk ${i}`);
        err.code = "UPLOAD_INCOMPLETE";
        err.status = 400;
        throw err;
      }
    }

    const dateFolder = UploadService.formatDateYmd();
    const userDir = path.join(this.targetRootDir, String(authUserId), dateFolder);
    await fs.mkdir(userDir, { recursive: true });

    const fileUuid = randomUUID();
    const extension = path.extname(String(meta.fileName || "")).slice(0, 20);
    const finalFileName = `${fileUuid}${extension}`;
    const finalPath = path.join(userDir, finalFileName);

    await fs.writeFile(finalPath, Buffer.alloc(0));

    for (let i = 1; i <= Number(meta.totalParts); i += 1) {
      const chunk = await fs.readFile(this.getPartPath(uploadId, i));
      await fs.appendFile(finalPath, chunk);
    }

    const relativePath = path.relative(process.cwd(), finalPath).replace(/\\/g, "/");

    const { rows } = await this.db.query(
      `
        INSERT INTO upload (
          file_name,
          file_uuid,
          file_path,
          user_id,
          share_with,
          file_size,
          mime_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, file_name, file_uuid, file_path, user_id, share_with, file_size, mime_type, created_at
      `,
      [
        String(meta.fileName),
        fileUuid,
        relativePath,
        authUserId,
        shareWith,
        Number(meta.fileSize),
        String(meta.mimeType || "application/octet-stream"),
      ]
    );

    await fs.rm(path.join(this.tmpRootDir, uploadId), { recursive: true, force: true });

    return {
      uploadId,
      percentage: 100,
      upload: rows[0],
    };
  }

  async cancelUpload(uploadIdInput, options = {}) {
    const uploadId = UploadService.validateUploadId(uploadIdInput);
    const meta = await this.readMeta(uploadId);

    this.assertAuthorizedUploadOwner(meta, options.auth);

    await fs.rm(path.join(this.tmpRootDir, uploadId), { recursive: true, force: true });

    return {
      uploadId,
      canceled: true,
    };
  }
}

module.exports = UploadService;
