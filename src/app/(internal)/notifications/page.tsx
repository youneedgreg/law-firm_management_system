import { NOTIFICATIONS } from "@/lib/data/firm";

export default function NotificationsPage() {
  return (
    <>
      <h1 className="page-title">Notifications</h1>
      <p className="page-subtitle">
        Hearing and court-date reminders, task deadlines and invoice due dates,
        delivered in-app and by email, SMS or WhatsApp.
      </p>

      {NOTIFICATIONS.map((notification) => (
        <div className="row row-icon" key={notification.id}>
          <i className={`${notification.icon} ink-accent-2`} aria-hidden />
          <div>
            <div style={{ fontSize: 14 }}>{notification.text}</div>
            <div className="eyebrow">
              {notification.time} · {notification.channel}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
