// routes/addresses.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const auth = require('../middleware/auth'); // reuse your auth

const DATA_DIR = path.join(__dirname, '..', 'data');
const ADDR_FILE = path.join(DATA_DIR, 'addresses.json');

// ensure data directory & file exist
async function ensureFile() {
    try {
        await fs.ensureDir(DATA_DIR);
        const exists = await fs.pathExists(ADDR_FILE);
        if (!exists) {
            await fs.writeJson(ADDR_FILE, []);
        }
    } catch (err) {
        console.error('ensureFile error:', err);
        throw err;
    }
}

async function readAddresses() {
    try {
        await ensureFile();
        const exists = await fs.pathExists(ADDR_FILE);
        if (!exists) return [];

        const data = await fs.readJson(ADDR_FILE);
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('readAddresses error:', err);
        return []; // Fallback to empty list instead of crashing
    }
}

async function writeAddresses(list) {
    try {
        await ensureFile();
        await fs.writeJson(ADDR_FILE, list, { spaces: 2 });
    } catch (err) {
        console.error('writeAddresses error:', err);
        throw err;
    }
}

// GET all addresses
router.get('/', auth, async (req, res) => {
    try {
        const addresses = await readAddresses();
        res.json(addresses);
    } catch (err) {
        console.error('GET /addresses error:', err);
        res.status(500).json({ message: 'Failed to read addresses', error: err.message });
    }
});

// POST add address
// body: { lat: number, lon: number, name?: string }
router.post('/', auth, async (req, res) => {
    try {
        const { lat, lon, name } = req.body || {};
        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return res.status(400).json({ message: 'lat and lon must be numbers' });
        }

        const newAddr = {
            id: uuidv4(),
            lat,
            lon,
            name: (name && String(name).trim()) || null,
            createdAt: new Date().toISOString()
        };

        const list = await readAddresses();
        list.push(newAddr);
        await writeAddresses(list);

        res.status(201).json(newAddr);
    } catch (err) {
        console.error('POST /addresses error', err);
        res.status(500).json({ message: 'Failed to save address', error: err.message });
    }
});

// DELETE /:id
router.delete('/:id', auth, async (req, res) => {
    try {
        const id = req.params.id;
        let list = await readAddresses();
        const idx = list.findIndex(a => a.id === id);
        if (idx === -1) return res.status(404).json({ message: 'Address not found' });

        const removed = list.splice(idx, 1)[0];
        await writeAddresses(list);

        res.json({ message: 'Deleted', removed });
    } catch (err) {
        console.error('DELETE /addresses/:id error', err);
        res.status(500).json({ message: 'Failed to delete address', error: err.message });
    }
});

module.exports = router;
