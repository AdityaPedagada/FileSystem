const Item = require('./item.model');
const itemService = require('./item.service');
const path = require('path');

exports.createItem = async (req, res) => {
  try {
    let item;

    if (!req.file) {
      // Handle folder creation
      item = new Item({
        name: req.body.name,
        originalName: req.body.name,
        type: 'folder',
        description: req.body.description,
        parentFolderId: req.body.parentFolderId,
        owner: req.user._id,
        originalDeviceId: req.session.deviceId // Assuming deviceId is stored in session
      });
    } else {
      // Handle file creation
      const file = req.file;
      const fileUrl = await itemService.uploadFile(file);
      const thumbnailUrl = await itemService.generateThumbnail(file);
      const metadata = await itemService.extractMetadata(file);
      const extension = path.extname(file.originalname).toLowerCase();
      const internalTags = itemService.generateInternalTags(file.mimetype, extension);

      item = new Item({
        name: file.originalname, // Keep full name with extension
        originalName: file.originalname,
        type: 'file',
        description: req.body.description,
        fileUrl,
        thumbnailUrl,
        extension,
        mimeType: file.mimetype,
        size: file.size,
        metadata,
        parentFolderId: req.body.parentFolderId,
        owner: req.user._id,
        originalDeviceId: req.session.deviceId,
        internalTags
      });
    }

    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const updates = { ...req.body, lastModifiedOn: new Date(), lastModifiedBy: req.user._id };
    const item = await Item.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getItems = async (req, res) => {
  try {
    const { parentFolderId } = req.query;
    const query = parentFolderId ? { parentFolderId } : { parentFolderId: null };
    const items = await Item.find(query).populate('owner', 'name email');
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await itemService.deleteFile(item.imageUrl);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};