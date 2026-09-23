import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateUser, useUpdateUser, useUsers } from "../../api/hooks";
import { ROLES, type Role, type User, type UserUpdate } from "../../api/types";
import { ErrorAlert } from "../../components/ErrorResult";
import { formatCny, formatDateTime } from "../../utils/format";

interface UserFormValues {
  email: string;
  display_name: string;
  password?: string;
  roles: Role[];
  is_active: boolean;
  daily_budget_cny?: number | null;
}

function UserModal({ editing, onClose }: { editing: User | "new" | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<UserFormValues>();
  const create = useCreateUser();
  const update = useUpdateUser();
  const isNew = editing === "new";

  const save = (values: UserFormValues) => {
    const onSuccess = () => {
      void message.success(t("common.saved"));
      onClose();
    };
    const budget = values.daily_budget_cny ?? null;
    if (editing === "new") {
      create.mutate(
        {
          email: values.email,
          display_name: values.display_name,
          password: values.password ?? "",
          roles: values.roles,
          daily_budget_cny: budget,
        },
        { onSuccess },
      );
    } else if (editing) {
      const body: UserUpdate = {
        display_name: values.display_name,
        roles: values.roles,
        is_active: values.is_active,
        daily_budget_cny: budget,
      };
      if (values.password) body.password = values.password;
      update.mutate({ id: editing.id, body }, { onSuccess });
    }
  };

  const initial: UserFormValues =
    editing && editing !== "new"
      ? {
          email: editing.email,
          display_name: editing.display_name,
          roles: editing.roles,
          is_active: editing.is_active,
          daily_budget_cny: editing.daily_budget_cny,
        }
      : {
          email: "",
          display_name: "",
          roles: ["creator"],
          is_active: true,
          daily_budget_cny: null,
        };

  return (
    <Modal
      open={editing !== null}
      title={isNew ? t("admin.users.create") : t("admin.users.edit")}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      confirmLoading={create.isPending || update.isPending}
      destroyOnHidden
    >
      <ErrorAlert error={create.error ?? update.error} />
      <Form<UserFormValues> form={form} layout="vertical" initialValues={initial} onFinish={save}>
        <Form.Item
          name="email"
          label={t("login.email")}
          rules={[{ required: true, type: "email", message: t("login.emailRequired") }]}
        >
          <Input disabled={!isNew} />
        </Form.Item>
        <Form.Item
          name="display_name"
          label={t("admin.users.displayName")}
          rules={[{ required: true, whitespace: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="password"
          label={isNew ? t("login.password") : t("admin.users.resetPassword")}
          extra={isNew ? undefined : t("admin.users.resetPasswordHelp")}
          rules={[
            { required: isNew, message: t("login.passwordRequired") },
            { min: 8, message: t("admin.users.passwordMin") },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="roles"
          label={t("admin.users.roles")}
          rules={[
            { required: true, type: "array", min: 1, message: t("admin.users.rolesRequired") },
          ]}
        >
          <Select
            mode="multiple"
            options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))}
          />
        </Form.Item>
        <Form.Item
          name="daily_budget_cny"
          label={t("admin.users.dailyBudget")}
          extra={t("admin.users.dailyBudgetHelp")}
        >
          <InputNumber min={0} prefix="¥" style={{ width: 200 }} />
        </Form.Item>
        {!isNew && (
          <Form.Item name="is_active" label={t("admin.users.active")} valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

export function UsersTab() {
  const { t, i18n } = useTranslation();
  const users = useUsers();
  const [editing, setEditing] = useState<User | "new" | null>(null);
  return (
    <>
      <Flex justify="flex-end" style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing("new")}>
          {t("admin.users.create")}
        </Button>
      </Flex>
      <ErrorAlert error={users.error} />
      <Table<User>
        rowKey="id"
        loading={users.isFetching}
        dataSource={users.data ?? []}
        pagination={false}
        columns={[
          { title: t("login.email"), dataIndex: "email" },
          { title: t("admin.users.displayName"), dataIndex: "display_name" },
          {
            title: t("admin.users.roles"),
            dataIndex: "roles",
            render: (roles: Role[]) =>
              roles.map((r) => (
                <Tag key={r} color="blue">
                  {t(`role.${r}`)}
                </Tag>
              )),
          },
          {
            title: t("admin.users.dailyBudget"),
            dataIndex: "daily_budget_cny",
            render: (v: number | null) =>
              v === null ? t("admin.users.defaultBudget") : formatCny(v),
          },
          {
            title: t("admin.users.active"),
            dataIndex: "is_active",
            render: (v: boolean) =>
              v ? (
                <Tag color="success">{t("admin.users.enabled")}</Tag>
              ) : (
                <Tag>{t("admin.users.disabled")}</Tag>
              ),
          },
          {
            title: t("jobs.columns.createdAt"),
            dataIndex: "created_at",
            render: (v: string) => formatDateTime(v, i18n.language),
          },
          {
            key: "edit",
            render: (_, user) => (
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(user)}>
                {t("common.edit")}
              </Button>
            ),
          },
        ]}
      />
      <UserModal editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}
