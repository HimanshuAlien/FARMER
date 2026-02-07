const mongoose = require('mongoose');
const fs = require('fs');

const uri = "mongodb+srv://skullcrusherhimu_db_user:JCE52sqieLwwKCGF@cluster0.rkfsdlh.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0";

async function verify() {
    const result = {
        success: false,
        error: null,
        dbName: null,
        host: null,
        collections: [],
        counts: {}
    };

    try {
        await mongoose.connect(uri);
        result.success = true;
        result.dbName = mongoose.connection.name;
        result.host = mongoose.connection.host;

        const collections = await mongoose.connection.db.listCollections().toArray();
        result.collections = collections.map(c => c.name);

        // Check specific collections
        const collectionsToCheck = ['users', 'crops', 'farmerprofiles'];
        for (const colName of collectionsToCheck) {
            if (result.collections.includes(colName)) {
                const count = await mongoose.connection.db.collection(colName).countDocuments();
                result.counts[colName] = count;
            } else {
                result.counts[colName] = 'MISSING';
            }
        }

    } catch (err) {
        result.error = err.message;
    } finally {
        await mongoose.disconnect();
        fs.writeFileSync('db_verification.json', JSON.stringify(result, null, 2));
        console.log("Verification complete. Check db_verification.json");
    }
}

verify();
