const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const exifr = require('exifr');
const path = require('path');
const crypto = require('crypto');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

exports.uploadFile = async (file) => {
  const fileId = uuidv4();
  const extension = path.extname(file.originalname);
  const key = `${fileId}${extension}`;

  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    const result = await s3.upload(params).promise();
    return result.Location;
  } catch (error) {
    throw new Error(`Error uploading file: ${error.message}`);
  }
};

exports.generateThumbnail = async (file) => {
  if (!file.mimetype.startsWith('image/')) return null;

  try {
    const buffer = await sharp(file.buffer)
      .resize(200, 200, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toBuffer();

    const thumbnailId = uuidv4();
    const key = `thumbnail-${thumbnailId}.jpg`;

    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    };

    const result = await s3.upload(params).promise();
    return result.Location;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    return null;
  }
};

exports.extractMetadata = async (file) => {
  try {
    const metadata = await exifr.parse(file.buffer);
    
    const fileCreatedOn = metadata.CreateDate || metadata.DateTimeOriginal || new Date();
    const fileModifiedOn = metadata.ModifyDate || new Date();

    return {
      ...metadata,
      fileCreatedOn,
      fileModifiedOn
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return {
      fileCreatedOn: new Date(),
      fileModifiedOn: new Date()
    };
  }
};

exports.generateInternalTags = (mimeType, extension) => {
  const tags = [];

  tags.push(mimeType);

  if (mimeType.startsWith('image/')) {
    tags.push('image');
  } else if (mimeType.startsWith('video/')) {
    tags.push('video');
  } else if (mimeType.startsWith('audio/')) {
    tags.push('audio');
  } else if (mimeType === 'application/pdf') {
    tags.push('pdf');
  } else if (['.doc', '.docx'].includes(extension)) {
    tags.push('document');
  } else if (['.xls', '.xlsx'].includes(extension)) {
    tags.push('spreadsheet');
  } else if (['.ppt', '.pptx'].includes(extension)) {
    tags.push('presentation');
  } else if (['.js', '.py', '.java', '.c', '.cpp', '.html', '.css', '.php'].includes(extension)) {
    tags.push('code');
  }

  return tags;
};

exports.getSignedUrl = async (fileUrl) => {
  const key = fileUrl.split('/').pop();
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Expires: 3600 // URL expires in 1 hour
  };

  try {
    return await s3.getSignedUrlPromise('getObject', params);
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error(`Error generating signed URL: ${error.message}`);
  }
};

exports.generateChecksumHash = (buffer) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    resolve(hash.digest('hex'));
  });
};

exports.getFullPath = async (itemId) => {
  const Item = require('./item.model'); // Require here to avoid circular dependency
  let fullPath = [];
  let currentItem = await Item.findById(itemId);

  while (currentItem) {
    fullPath.unshift(currentItem.name);
    if (!currentItem.parentFolderId) break;
    currentItem = await Item.findById(currentItem.parentFolderId);
  }

  return fullPath.join('/');
};

exports.deleteFile = async (fileUrl) => {
  if (!fileUrl) return;

  try {
    const key = fileUrl.split('/').pop();
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    await s3.deleteObject(params).promise();
  } catch (error) {
    throw new Error(`Error deleting file: ${error.message}`);
  }
};
