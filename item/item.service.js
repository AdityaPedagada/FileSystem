const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const exifr = require('exifr');
const path = require('path');

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
    return metadata;
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return {};
  }
};

exports.generateInternalTags = (mimeType, extension) => {
  const tags = [];

  if (mimeType.startsWith('image/')) {
    tags.push('media', 'image');
  } else if (mimeType.startsWith('video/')) {
    tags.push('media', 'video');
  } else if (['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType)) {
    tags.push('document');
  } else if (['.js', '.py', '.java', '.c', '.cpp', '.html', '.css', '.php'].includes(extension)) {
    tags.push('code');
  }

  return tags;
};

exports.deleteFile = async (fileUrl) => {
  const key = fileUrl.split('/').pop();
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
  };

  try {
    await s3.deleteObject(params).promise();
  } catch (error) {
    throw new Error(`Error deleting file: ${error.message}`);
  }
};