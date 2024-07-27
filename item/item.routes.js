const express = require('express');
const router = express.Router();
const itemController = require('./item.controller');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), itemController.createItem);
router.get('/', itemController.getItems);
router.get('/:id', itemController.getItem);
router.put('/:id', itemController.updateItem);
router.delete('/:id', itemController.deleteItem);
router.get('archive/:id', itemController.archiveItem);
router.get('restore/:id', itemController.restoreItem);
router.post('access/:id', itemController.updateAccess);

module.exports = router;