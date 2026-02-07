const mongoose = require('mongoose');

const uri = "mongodb+srv://skullcrusherhimu_db_user:JCE52sqieLwwKCGF@cluster0.rkfsdlh.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0";

async function verifyConnection() {
    try {
        console.log("Attempting to connect to:", uri.replace(/:([^@]+)@/, ':****@'));
        await mongoose.connect(uri);

        console.log("✅ Connected!");
        console.log("Database Name:", mongoose.connection.name);
        console.log("Host:", mongoose.connection.host);

        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log("\nAvailable Collections:");
        collections.forEach(c => console.log(` - ${c.name}`));

        if (mongoose.connection.name !== 'test') {
            console.error("\n❌ WARNING: Not connected to 'test' database!");
        } else {
            console.log("\n✅ Correctly connected to 'test' database.");
        }

        // Check for user count to verify data exists
        const usersCollection = mongoose.connection.db.collection('users');
        const userCount = await usersCollection.countDocuments();
        console.log(`\nUsers count in 'users' collection: ${userCount}`);

    } catch (err) {
        console.error("❌ Connection failed:", err);
    } finally {
        await mongoose.disconnect();
    }
}

verifyConnection();
