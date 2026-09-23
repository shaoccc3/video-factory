import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Flex, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobCommand } from "../api/hooks";
import { CHECKLIST_KEYS, type ChecklistKey, type JobDetail } from "../api/types";
import { ErrorAlert } from "./ErrorResult";

type Checklist = Record<ChecklistKey, boolean>;

const EMPTY_CHECKLIST = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, false])) as Checklist;

export function allChecked(checklist: Checklist): boolean {
  return CHECKLIST_KEYS.every((key) => checklist[key]);
}

/** 審核表單：通過需五項全勾；退回必填原因 */
export function ReviewForm({ job, onDone }: { job: JobDetail; onDone?: () => void }) {
  const { t } = useTranslation();
  const [checklist, setChecklist] = useState<Checklist>(EMPTY_CHECKLIST);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const command = useJobCommand(job.id);
  const complete = allChecked(checklist);

  const decide = (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reason.trim()) {
      setReasonError(true);
      return;
    }
    if (decision === "approved" && !complete) return;
    command.mutate(
      { type: "review", body: { decision, checklist, reason: reason.trim() } },
      { onSuccess: () => onDone?.() },
    );
  };

  return (
    <div>
      <Typography.Title level={5}>{t("review.checklistTitle")}</Typography.Title>
      <Space orientation="vertical" style={{ marginBottom: 16 }}>
        {CHECKLIST_KEYS.map((key) => (
          <Checkbox
            key={key}
            checked={checklist[key]}
            onChange={(e) => setChecklist((cur) => ({ ...cur, [key]: e.target.checked }))}
          >
            {t(`review.checklist.${key}`)}
          </Checkbox>
        ))}
      </Space>
      <Typography.Title level={5}>{t("review.reason")}</Typography.Title>
      <Input.TextArea
        aria-label={t("review.reason")}
        rows={3}
        value={reason}
        status={reasonError ? "error" : ""}
        placeholder={t("review.reasonPlaceholder")}
        onChange={(e) => {
          setReason(e.target.value);
          if (e.target.value.trim()) setReasonError(false);
        }}
      />
      {reasonError && (
        <Typography.Text type="danger" role="alert">
          {t("review.reasonRequired")}
        </Typography.Text>
      )}
      {!complete && (
        <Alert type="info" showIcon style={{ marginTop: 12 }} title={t("review.checklistHint")} />
      )}
      <div style={{ marginTop: 12 }}>
        <ErrorAlert error={command.error} />
      </div>
      <Flex gap={8} style={{ marginTop: 12 }}>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          disabled={!complete}
          loading={command.isPending && command.variables?.type === "review" && complete}
          onClick={() => decide("approved")}
        >
          {t("review.approve")}
        </Button>
        <Button danger icon={<CloseOutlined />} onClick={() => decide("rejected")}>
          {t("review.reject")}
        </Button>
      </Flex>
    </div>
  );
}
