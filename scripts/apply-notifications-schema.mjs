import fs from 'node:fs';

const file = 'prisma/schema.prisma';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('model DeviceRegistration') && s.includes('model NotificationCampaign')) {
  console.log('SafeHouse notification schema already applied.');
  process.exit(0);
}

function exact(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Notification schema patch failed: ${label}`);
  s = s.replace(oldText, newText);
}

exact(
  '  auditLogs       AuditLog[] @relation("AuditActor")\n}',
  '  auditLogs       AuditLog[] @relation("AuditActor")\n  deviceRegistrations DeviceRegistration[]\n}',
  'user relation'
);
exact(
  '  auditLogs     AuditLog[]\n  rentRevisions RentRevision[]\n',
  '  auditLogs     AuditLog[]\n  rentRevisions RentRevision[]\n  notificationCampaigns NotificationCampaign[]\n',
  'property relation'
);

const marker = '\nmodel AuditLog {';
if (!s.includes(marker)) throw new Error('Notification schema patch failed: AuditLog marker');
const models = `
model DeviceRegistration {
  id             String   @id @default(cuid())
  userId         String
  installationId String   @unique
  platform       String   @default("ANDROID")
  appVersion     String?
  enabled        Boolean  @default(true)
  lastSeenAt     DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, enabled])
}

model NotificationCampaign {
  id                 String   @id @default(cuid())
  propertyId         String
  createdByUserId    String
  title              String
  body               String
  audienceType       String
  selectedStudentIds Json?
  financialYear      Int?
  financialMonth     Int?
  scheduleType       String
  scheduleTimes      Json
  startDate          String
  endDate            String
  timezone           String
  status             String   @default("ACTIVE")
  nextRunAt          DateTime?
  lastRunAt          DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  property   Property               @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  deliveries NotificationDelivery[]

  @@index([propertyId, status, nextRunAt])
  @@index([createdByUserId, createdAt])
}

model NotificationDelivery {
  id                String   @id @default(cuid())
  campaignId        String
  userId            String
  installationId    String
  occurrenceKey     String
  status            String
  providerMessageId String?
  errorCode         String?
  sentAt            DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  campaign NotificationCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@unique([campaignId, installationId, occurrenceKey])
  @@index([campaignId, status])
  @@index([userId, sentAt])
}
`;
s = s.replace(marker, `\n${models}${marker}`);
fs.writeFileSync(file, s);
console.log('SafeHouse notification schema applied.');
