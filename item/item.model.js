const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Will include extension for files
  originalName: { type: String, required: true },
  type: { type: String, enum: ['file', 'folder'], required: true },
  description: String,
  fileUrl: String,
  thumbnailUrl: String,
  extension: String,
  mimeType: String,
  size: Number,
  metadata: mongoose.Schema.Types.Mixed,
  createdOn: { type: Date, default: Date.now },
  lastModifiedOn: { type: Date, default: Date.now },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  access: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    permission: { type: String, enum: ['read', 'write', 'admin'] }
  }],
  parentFolderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  originalLocation: String,
  originalDeviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  internalTags: [String],
  userTags: [String],
  fileCreatedOn: { type: Date },
  fileModifiedOn: { type: Date }
});

module.exports = mongoose.model('Item', itemSchema);