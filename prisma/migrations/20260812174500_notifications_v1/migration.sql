-- SafeHouse notification campaigns and Firebase Installation ID registrations.
CREATE TABLE "DeviceRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "appVersion" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceRegistration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "selectedStudentIds" JSONB,
    "financialYear" INTEGER,
    "financialMonth" INTEGER,
    "scheduleType" TEXT NOT NULL,
    "scheduleTimes" JSONB NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceRegistration_installationId_key" ON "DeviceRegistration"("installationId");
CREATE INDEX "DeviceRegistration_userId_enabled_idx" ON "DeviceRegistration"("userId", "enabled");
CREATE INDEX "NotificationCampaign_propertyId_status_nextRunAt_idx" ON "NotificationCampaign"("propertyId", "status", "nextRunAt");
CREATE INDEX "NotificationCampaign_createdByUserId_createdAt_idx" ON "NotificationCampaign"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "NotificationDelivery_campaignId_installationId_occurrenceKey_key" ON "NotificationDelivery"("campaignId", "installationId", "occurrenceKey");
CREATE INDEX "NotificationDelivery_campaignId_status_idx" ON "NotificationDelivery"("campaignId", "status");
CREATE INDEX "NotificationDelivery_userId_sentAt_idx" ON "NotificationDelivery"("userId", "sentAt");
ALTER TABLE "DeviceRegistration" ADD CONSTRAINT "DeviceRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
