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
        originalDeviceId: req.session.deviceId,
        createdOn: new Date(),
        lastModifiedOn: new Date()
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
        name: file.originalname,
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
        internalTags,
        createdOn: new Date(),
        lastModifiedOn: new Date(),
        fileCreatedOn: metadata.fileCreatedOn,
        fileModifiedOn: metadata.fileModifiedOn
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
    const itemId = req.params.id;
    const existingItem = await Item.findById(itemId);
    
    if (!existingItem) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const allowedUpdates = ['name', 'description'];
    const updates = {};

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    updates.lastModifiedOn = new Date();
    updates.lastModifiedBy = req.user._id;

    if (req.file) {
      const file = req.file;
      
      updates.fileUrl = await itemService.uploadFile(file);
      updates.thumbnailUrl = await itemService.generateThumbnail(file);
      
      const metadata = await itemService.extractMetadata(file);
      updates.metadata = metadata;
      
      updates.originalName = file.originalname;
      updates.extension = path.extname(file.originalname).toLowerCase();
      updates.mimeType = file.mimetype;
      updates.size = file.size;
      updates.internalTags = itemService.generateInternalTags(file.mimetype, updates.extension);
      updates.fileCreatedOn = metadata.fileCreatedOn;
      updates.fileModifiedOn = metadata.fileModifiedOn;

      if (existingItem.fileUrl) {
        await itemService.deleteFile(existingItem.fileUrl);
      }
    }

    const updatedItem = await Item.findByIdAndUpdate(itemId, updates, { new: true });
    
    res.json(updatedItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
exports.getItems = async (req, res) => {
  try {
    const {
      parentFolderId,
      page = 1,
      limit = 20,
      search,
      sortBy = 'name',
      sortOrder = 'asc',
      startDate,
      endDate,
      fileType,
      owner
    } = req.query;

    const query = {};

    query.$or = [
      { owner: req.user._id },
      { 'access.user': req.user._id }
    ];

    if (parentFolderId) {
      query.parentFolderId = parentFolderId;
    } else {
      query.parentFolderId = null; // Root items
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate && endDate) {
      query.createdOn = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (fileType) {
      query.type = fileType;
    }

    if (owner) {
      query.owner = mongoose.Types.ObjectId(owner);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (page - 1) * limit;

    const items = await Item.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .populate('owner', 'name email')
      .populate('lastModifiedBy', 'name email')
      .lean();

    const itemsWithSignedUrls = await Promise.all(items.map(async (item) => {
      if (item.type === 'file' && item.fileUrl) {
        item.signedUrl = await itemService.getSignedUrl(item.fileUrl);
      }
      return item;
    }));

    const totalItems = await Item.countDocuments(query);

    res.json({
      items: itemsWithSignedUrls,
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
      itemsPerPage: limit
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('lastModifiedBy', 'name email')
      .populate('parentFolderId', 'name')
      .lean();

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id));

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (item.type === 'file' && item.fileUrl) {
      item.signedUrl = await itemService.getSignedUrl(item.fileUrl);
    }

    item.isOwner = item.owner.equals(req.user._id);
    item.userPermission = item.access.find(access => access.user.equals(req.user._id))?.permission || 'read';
    item.fullPath = await itemService.getFullPath(item._id);

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
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