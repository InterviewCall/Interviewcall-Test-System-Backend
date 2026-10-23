# Invitation email: delivered or bounced

The Tests page shows what happened to each invitation email: queued, sent, delivered, delayed, bounced,
marked as spam, or rejected. Amazon SES reports these, so it only works with `MAIL_DRIVER=ses`.

## How it works

1. Each invitation email gets a unique reference. It is saved on the test before the email is queued,
   and attached to the email as an SES message tag called `mailRef`.
2. SES publishes every event for that email (Send, Delivery, Bounce, Complaint, Reject, DeliveryDelay)
   to an SNS topic, through a configuration set.
3. SNS posts the event to `POST /api/v1/mail-events/ses` on the API.
4. The API checks AWS's signature, finds the test by `mailRef`, and records the status.
   A status only moves forward (a late "sent" never undoes "delivered"), and rescheduling or resending
   starts again from "queued".

## AWS setup (once)

1. **SNS topic.** Create a Standard topic, for example `ses-events`, in the same region as SES.
2. **SES configuration set.** SES, Configuration sets, create one (for example `interviewcall-tests`).
   Add an event destination of type *Amazon SNS*, pick the events Send, Delivery, Bounce, Complaint,
   Rejects and Delivery delays (leave opens and clicks off), and choose the topic.
3. **Subscribe the API.** In the topic, create a subscription: protocol *HTTPS*, endpoint
   `https://<your API address>/api/v1/mail-events/ses`. The API confirms it by itself (check the
   subscription shows *Confirmed*). The address must be public and use a certificate browsers trust.
4. **Environment (API and worker).**
   - `SES_CONFIGURATION_SET=interviewcall-tests` (the worker sends with it)
   - `MAIL_EVENTS_TOPIC_ARN=arn:aws:sns:<region>:<account>:ses-events` (the API only accepts this topic)
5. Run `npx prisma migrate deploy` and restart the API and the worker.

The IAM user the worker sends with also needs permission to use the configuration set
(`ses:SendEmail` on the configuration set resource as well as the identity).

Without `MAIL_EVENTS_TOPIC_ARN` the webhook answers 404 and emails simply stay at "Email queued".

## Limits

- Tests booked before this change have no status (the Tests page shows nothing for them).
- A bounce for a wrong address cannot be corrected from the console yet; reschedule with the right
  address or contact the candidate another way.
- "Sent" and "delivered" cover SES and the recipient's mail server. They do not prove the candidate read it.
