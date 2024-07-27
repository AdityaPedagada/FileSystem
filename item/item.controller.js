const Item = require('./item.model');
const itemService = require('./item.service');
const path = require('path');

exports.createItem = async (req, res) => {
  try {
    let item;

    if (!req.file) {
      item = new Item({
        name: req.body.name,
        originalName: req.body.name,
        type: 'folder',
        description: req.body.description,
        parentFolderId: req.body.parentFolderId,
        owner: req.user._id,
        originalDeviceId: req.session.deviceId,
        createdOn: new Date(),
        lastModifiedOn: new Date(),
        version: 1,
        isArchived: false,
        isHidden: req.body.isHidden || false,
        customProperties: req.body.customProperties || {}
      });
    } else {
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
        fileModifiedOn: metadata.fileModifiedOn,
        version: 1,
        isArchived: false,
        isEncrypted: req.body.isEncrypted || false,
        checksumHash: await itemService.generateChecksumHash(file.buffer),
        compressionType: req.body.compressionType,
        isHidden: req.body.isHidden || false,
        customProperties: req.body.customProperties || {}
      });
    }

    // Check if user has write access to parent folder
    if (item.parentFolderId) {
      const parentFolder = await Item.findById(item.parentFolderId);
      if (!parentFolder) {
        return res.status(404).json({ message: 'Parent folder not found' });
      }
      const hasAccess = parentFolder.owner.equals(req.user._id) || 
        parentFolder.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to parent folder' });
      }
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

    const hasAccess = existingItem.owner.equals(req.user._id) || 
      existingItem.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const allowedUpdates = ['name', 'description', 'isArchived', 'isHidden', 'customProperties', 'userTags', 'parentFolderId', 'isEncrypted', 'compressionType', 'sharedLink' ];
    const updates = {};

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    updates.lastModifiedOn = new Date();
    updates.lastModifiedBy = req.user._id;
    updates.version = existingItem.version + 1;

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
      updates.checksumHash = await itemService.generateChecksumHash(file.buffer);

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
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && access.permission === 'admin');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Item.findByIdAndDelete(req.params.id);
    if (item.fileUrl) {
      await itemService.deleteFile(item.fileUrl);
    }
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.archiveItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    item.isArchived = true;
    item.lastModifiedOn = new Date();
    item.lastModifiedBy = req.user._id;

    await item.save();
    
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.restoreItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    item.isArchived = false;
    item.lastModifiedOn = new Date();
    item.lastModifiedBy = req.user._id;

    await item.save();
    
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateAccess = async (req, res) => {
  try {
    const { userId, permission } = req.body;
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && access.permission === 'admin');
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const accessIndex = item.access.findIndex(a => a.user.toString() === userId);
    if (accessIndex > -1) {
      item.access[accessIndex].permission = permission;
    } else {
      item.access.push({ user: userId, permission });
    }

    item.lastModifiedOn = new Date();
    item.lastModifiedBy = req.user._id;
    
    await item.save();
    
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createSharedLink = async (req, res) => {
  try {
    const { expirationDate } = req.body;
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    item.sharedLink = await itemService.generateSharedLink();
    item.expirationDate = expirationDate ? new Date(expirationDate) : null;
    item.lastModifiedOn = new Date();
    item.lastModifiedBy = req.user._id;

    await item.save();
    
    res.json({ sharedLink: item.sharedLink, expirationDate: item.expirationDate });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.removeSharedLink = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id) && ['write', 'admin'].includes(access.permission));
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    item.sharedLink = null;
    item.expirationDate = null;
    item.lastModifiedOn = new Date();
    item.lastModifiedBy = req.user._id;

    await item.save();
    
    res.json({ message: 'Shared link removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateLastAccessed = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    const hasAccess = item.owner.equals(req.user._id) || 
      item.access.some(access => access.user.equals(req.user._id));
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    item.lastAccessedOn = new Date();
    await item.save();
    
    res.json({ message: 'Last accessed time updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};