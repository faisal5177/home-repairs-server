const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );

    // Service related apis
    const servicesCollection = client.db('homeRepairs').collection('services');
    const serviceApplicationCollection = client
      .db('homeRepairs')
      .collection('service_applications');

    app.get('/services', async (req, res) => {
      const email = req.query.email;
      let query = {};
      if (email) {
        query = { providerEmail: email };
      }
      const cursor = servicesCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    //  Create a new service
    app.post('/services', async (req, res) => {
      const newService = req.body;
      const result = await servicesCollection.insertOne(newService);
      result.insertedId
        ? res.status(201).json({ serviceId: result.insertedId })
        : res.status(400).json({ error: 'Service creation failed' });
    });

    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    app.get('/service-application/services/:service_id', async (req, res) => {
      const serviceId = req.params.service_id;
      const query = { service_id: serviceId };
      const applications = await serviceApplicationCollection
        .find(query)
        .toArray();
      res.send(applications);
    });

    // Service application apis
    app.get('/service-application', async (req, res) => {
      const email = req.query.email;
      const query = { applicant_email: email };
      const result = await serviceApplicationCollection.find(query).toArray();

      for (const application of result) {
        console.log(application.service_id);
        const query1 = { _id: new ObjectId(application.service_id) };
        const service = await servicesCollection.findOne(query1);
        if (service) {
          application.serviceName = service.serviceName;
          application.providerImage = service.providerImage;
          application.serviceArea = service.serviceArea;
          application.providerName = service.providerName;
          application.price = service.price;
          application.createdAt = service.createdAt;
        }
      }

      res.send(result);
    });

    app.post('/service-applications', async (req, res) => {
      const application = req.body;
      application.createdAt = new Date();
      const result = await serviceApplicationCollection.insertOne(application);

      const id = application.service_id;
      const query = { _id: new ObjectId(id) };
      const service = await servicesCollection.findOne(query);
      let newCount = 0;
      if (service.applicationCount) {
        newCount = service.applicationCount + 1;
      } else {
        newCount = 1;
      }

      // Update the service application count
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          applicationCount: newCount,
        },
      };

      const updateResult = await servicesCollection.updateOne(
        filter,
        updateDoc
      );

      res.send(result);
    });

    // Delete service application by ID
    app.delete('/service-application/:id', async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await serviceApplicationCollection.deleteOne(query);
      res.send(result);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Service is falling from the sky');
});

app.listen(port, () => {
  console.log(`Service is waiting at: ${port}`);
});
