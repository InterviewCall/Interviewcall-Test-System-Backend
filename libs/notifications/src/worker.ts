// A separate entry point on purpose: the API imports "@app/notifications" and must not
// load the AWS SDK or the template engine, which only the worker needs.
export { NotificationsWorkerModule } from './notifications-worker.module.js';
