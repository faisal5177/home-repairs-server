const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );

    const servicesCollection = client.db('homeRepairs').collection('services');
    const serviceApplicationCollection = client
      .db('homeRepairs')
      .collection('service_applications');

    // Get all services or by provider email
    app.get('/services', async (req, res) => {
      const providerEmail = req.query.providerEmail;
      let query = {};
      if (providerEmail) {
        query = {
          providerEmail,
          applicationCount: { $gt: 0 },
        };
      }
      const result = await servicesCollection.find(query).toArray();
      res.send(result);
    });

    // Get service by ID
    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const result = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Create a new service
    app.post('/services', async (req, res) => {
      const newService = req.body;
      newService.createdAt = new Date().toISOString();
      newService.applicationCount = 0;
      const result = await servicesCollection.insertOne(newService);
      result.insertedId
        ? res.status(201).json({ serviceId: result.insertedId })
        : res.status(400).json({ error: 'Service creation failed' });
    });

    // Get applications for a specific service
    app.get('/service-application/services/:service_id', async (req, res) => {
      const serviceId = req.params.service_id;
      const query = { service_id: serviceId };
      const applications = await serviceApplicationCollection
        .find(query)
        .toArray();
      res.send(applications);
    });

    // Get applications by applicant email
    app.get('/service-application', async (req, res) => {
      const email = req.query.email;
      const query = { applicant_email: email };
      const result = await serviceApplicationCollection.find(query).toArray();

      for (const application of result) {
        const service = await servicesCollection.findOne({
          _id: new ObjectId(application.service_id),
        });
        if (service) {
          Object.assign(application, {
            serviceName: service.serviceName,
            providerImage: service.providerImage,
            serviceArea: service.serviceArea,
            providerName: service.providerName,
            price: service.price,
            createdAt: service.createdAt,
          });
        }
      }

      res.send(result);
    });

    // Create a new service application
    app.post('/service-applications', async (req, res) => {
      const application = req.body;
      application.createdAt = new Date().toISOString();
      application.status = 'Pending';

      const result = await serviceApplicationCollection.insertOne(application);

      // Update applicationCount in service
      const id = application.service_id;
      const service = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      const newCount = (service?.applicationCount || 0) + 1;

      await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { applicationCount: newCount } }
      );

      res.send(result);
    });

    app.patch('/service-application/:id', async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid application ID' });
      }

      const result = await serviceApplicationCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount > 0) {
        res.send({ message: 'Application status updated successfully' });
      } else {
        res
          .status(404)
          .send({ message: 'Application not found or status unchanged' });
      }
    });

    // Delete application by ID
    app.delete('/service-application/:id', async (req, res) => {
      const { id } = req.params;
      const result = await serviceApplicationCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ✅ UPDATE service (location & date)
    app.put('/services/:id', async (req, res) => {
      const { id } = req.params;
      const { serviceArea, applicationDate } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send('Invalid service ID');
      }

      const updateFields = {};
      if (typeof serviceArea === 'string')
        updateFields.serviceArea = serviceArea;
      if (typeof applicationDate === 'string')
        updateFields.applicationDate = applicationDate;

      try {
        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send('Service not found or no change made.');
        }

        res.send({ success: true, message: 'Service updated successfully' });
      } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).send('Internal server error');
      }
    });

    // DELETE route in Express
    app.delete('/services/:id', async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid service ID' });
      }

      const result = await servicesCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount > 0) {
        res.send({ message: 'Service deleted successfully' });
      } else {
        res.status(404).json({ error: 'Service not found' });
      }
    });
  } finally {
    // Keep connection alive
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Service is falling from the sky');
});

app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
