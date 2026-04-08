import { useEffect, useState, type FormEvent } from "react";

import { LogIn, LogOut, Shield, UserRound, Users } from "lucide-react";

import type { Project } from "@/domain/model";
import type {
  AuthenticatedWorkspaceAuth,
  WorkspaceManagedUser,
  WorkspaceManagedUserSetupResult,
} from "@/lib/runtime-client";
import { RECOMMENDED_DEV_RUNTIME_COMMAND } from "@/lib/runtime-dev";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function sortManagedUsers(users: WorkspaceManagedUser[]): WorkspaceManagedUser[] {
  return [...users].sort((left, right) =>
    Number(right.isAdmin) - Number(left.isAdmin)
    || left.createdAt.localeCompare(right.createdAt)
    || left.handle.localeCompare(right.handle),
  );
}

function replaceManagedUser(users: WorkspaceManagedUser[], nextUser: WorkspaceManagedUser): WorkspaceManagedUser[] {
  const existing = users.some((user) => user.id === nextUser.id);
  return sortManagedUsers(
    existing
      ? users.map((user) => (user.id === nextUser.id ? nextUser : user))
      : [...users, nextUser],
  );
}

function ManagedUserLoadingCard(props: { index: number }) {
  const { index } = props;

  return (
    <Card key={`managed-user-loading-${index}`} className="border-border/80">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-18 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-10 w-40 animate-pulse rounded bg-muted" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </CardFooter>
    </Card>
  );
}

function readSetupTokenFromLocation(): string | undefined {
  if (typeof globalThis === "undefined" || !("location" in globalThis)) {
    return undefined;
  }

  const token = new URLSearchParams(globalThis.location.search).get("setup")?.trim();
  return token || undefined;
}

function clearSetupTokenFromLocation(): void {
  if (typeof globalThis === "undefined" || !("location" in globalThis) || !("history" in globalThis)) {
    return;
  }

  const url = new URL(globalThis.location.href);
  url.searchParams.delete("setup");
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  globalThis.history.replaceState(null, "", nextPath || "/");
}

export function WorkspaceAuthGate(props: {
  canRegister?: boolean;
  connected: boolean;
  error?: string;
  onLogin: (input: { handle: string; password: string; displayName?: string }) => Promise<void>;
  onCompleteSetup: (input: { token: string; password: string }) => Promise<void>;
}) {
  const { canRegister = false, connected, error, onLogin, onCompleteSetup } = props;
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState<string | undefined>(() => readSetupTokenFromLocation());
  const [submitting, setSubmitting] = useState(false);
  const mode = setupToken ? "setup" : (canRegister ? "register" : "login");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!password.trim()) {
      return;
    }

    if (mode === "setup") {
      if (!setupToken) {
        return;
      }

      setSubmitting(true);
      try {
        await onCompleteSetup({
          token: setupToken,
          password,
        });
        clearSetupTokenFromLocation();
        setSetupToken(undefined);
        setPassword("");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!handle.trim()) {
      return;
    }
    if (mode === "register" && !displayName.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await onLogin({
        displayName: mode === "register" ? displayName : undefined,
        handle,
        password,
      });
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToLogin = (): void => {
    clearSetupTokenFromLocation();
    setSetupToken(undefined);
    setPassword("");
  };

  const title = mode === "register"
    ? "Register your OpenAquarium admin"
    : mode === "setup"
      ? "Set your OpenAquarium password"
      : "Sign in to OpenAquarium";
  const description = mode === "register"
    ? "当前还没有有效用户。首个完成注册的人会自动成为 workspace admin。"
    : mode === "setup"
      ? "使用管理员提供的 setup link / token，自助设置你的初始密码。"
      : "仅允许已分配的用户登录。登录后只能看到你被授权的 project 和 room。";
  const submitLabel = mode === "register"
    ? (submitting ? "Registering..." : "Register")
    : mode === "setup"
      ? (submitting ? "Setting password..." : "Set password")
      : (submitting ? "Signing in..." : "Login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md border-border/80 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Auth required</Badge>
            <Badge variant="outline">{connected ? "Runtime online" : "Runtime offline"}</Badge>
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => { void handleSubmit(event); }}>
            {mode === "register" ? (
              <div className="space-y-2">
                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Display name</p>
                <Input aria-label="Display name" autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
            ) : null}
            {mode !== "setup" ? (
              <div className="space-y-2">
                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Handle</p>
                <Input
                  aria-label="Handle"
                  autoComplete="username"
                  autoFocus={mode !== "register"}
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Password</p>
              <Input
                aria-label="Password"
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
            {!connected ? <p className="m-0 text-xs text-muted-foreground">{`Start the runtime first with \`${RECOMMENDED_DEV_RUNTIME_COMMAND}\`.`}</p> : null}
            <Button className="w-full" disabled={!connected || submitting} type="submit">
              <LogIn size={16} />
              {submitLabel}
            </Button>
            {mode === "setup" ? (
              <Button className="w-full" onClick={handleBackToLogin} type="button" variant="ghost">
                Back to Login
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export function WorkspaceAuthProfileControl(props: {
  auth: AuthenticatedWorkspaceAuth;
  error?: string;
  availableProjects?: Project[];
  onLogout: () => Promise<void>;
  onUpdateMe: (input: { handle?: string; displayName?: string }) => Promise<void>;
  onListManagedUsers?: () => Promise<WorkspaceManagedUser[]>;
  onCreateManagedUser?: (input: { handle: string; displayName: string; isAdmin?: boolean }) => Promise<WorkspaceManagedUserSetupResult>;
  onUpdateManagedUser?: (input: {
    userId: string;
    handle?: string;
    displayName?: string;
    isAdmin?: boolean;
  }) => Promise<WorkspaceManagedUser>;
  onIssueManagedUserSetup?: (input: { userId: string }) => Promise<WorkspaceManagedUserSetupResult>;
  onSetManagedProjectMembership?: (input: {
    userId: string;
    projectId: string;
    role?: "owner" | "admin" | "member";
    remove?: boolean;
  }) => Promise<WorkspaceManagedUser>;
}) {
  const {
    auth,
    error,
    availableProjects = [],
    onLogout,
    onUpdateMe,
    onListManagedUsers = () => Promise.resolve([]),
    onCreateManagedUser = () => Promise.reject(new Error("User management is not available.")),
    onUpdateManagedUser = () => Promise.reject(new Error("User management is not available.")),
    onIssueManagedUserSetup = () => Promise.reject(new Error("User management is not available.")),
    onSetManagedProjectMembership = () => Promise.reject(new Error("User management is not available.")),
  } = props;
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [handle, setHandle] = useState(auth.user.handle);
  const [displayName, setDisplayName] = useState(auth.user.displayName);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [managedUsers, setManagedUsers] = useState<WorkspaceManagedUser[]>([]);
  const [loadingManagedUsers, setLoadingManagedUsers] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState<string | undefined>(undefined);
  const [latestSetup, setLatestSetup] = useState<WorkspaceManagedUserSetupResult | undefined>(undefined);
  const [createHandle, setCreateHandle] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createIsAdmin, setCreateIsAdmin] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | undefined>(undefined);
  const [pendingSetupUserId, setPendingSetupUserId] = useState<string | undefined>(undefined);
  const [pendingMembershipKey, setPendingMembershipKey] = useState<string | undefined>(undefined);
  const [userDrafts, setUserDrafts] = useState<Record<string, {
    handle: string;
    displayName: string;
    isAdmin: boolean;
  }>>({});

  useEffect(() => {
    if (!open) {
      setHandle(auth.user.handle);
      setDisplayName(auth.user.displayName);
      setActiveTab("profile");
      setManagedUsersError(undefined);
      setLatestSetup(undefined);
    }
  }, [auth.user.displayName, auth.user.handle, open]);

  useEffect(() => {
    setUserDrafts(
      Object.fromEntries(
        managedUsers.map((user) => [
          user.id,
          {
            handle: user.handle,
            displayName: user.displayName,
            isAdmin: user.isAdmin,
          },
        ]),
      ),
    );
  }, [managedUsers]);

  useEffect(() => {
    if (!open || !auth.user.isAdmin) {
      return;
    }

    let cancelled = false;
    setLoadingManagedUsers(true);
    setManagedUsersError(undefined);
    void onListManagedUsers()
      .then((users) => {
        if (cancelled) {
          return;
        }
        setManagedUsers(sortManagedUsers(users));
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setManagedUsersError(loadError instanceof Error ? loadError.message : "Failed to load users.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingManagedUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth.user.isAdmin, onListManagedUsers, open]);

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      await onUpdateMe({
        handle,
        displayName,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoutClick = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await onLogout();
      setOpen(false);
    } finally {
      setLoggingOut(false);
    }
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!createHandle.trim() || !createDisplayName.trim()) {
      return;
    }

    setCreatingUser(true);
    setManagedUsersError(undefined);
    try {
      const createdUser = await onCreateManagedUser({
        handle: createHandle,
        displayName: createDisplayName,
        isAdmin: createIsAdmin,
      });
      setManagedUsers((current) => replaceManagedUser(current, createdUser.user));
      setLatestSetup(createdUser);
      setCreateHandle("");
      setCreateDisplayName("");
      setCreateIsAdmin(false);
    } catch (createError) {
      setManagedUsersError(createError instanceof Error ? createError.message : "Failed to create user.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleSaveManagedUser = async (userId: string): Promise<void> => {
    const draft = userDrafts[userId];
    if (!draft) {
      return;
    }

    setPendingUserId(userId);
    setManagedUsersError(undefined);
    try {
      const updatedUser = await onUpdateManagedUser({
        userId,
        handle: draft.handle,
        displayName: draft.displayName,
        isAdmin: draft.isAdmin,
      });
      setManagedUsers((current) => replaceManagedUser(current, updatedUser));
    } catch (updateError) {
      setManagedUsersError(updateError instanceof Error ? updateError.message : "Failed to update user.");
    } finally {
      setPendingUserId(undefined);
    }
  };

  const handleIssueSetup = async (userId: string): Promise<void> => {
    setPendingSetupUserId(userId);
    setManagedUsersError(undefined);
    try {
      const result = await onIssueManagedUserSetup({ userId });
      setManagedUsers((current) => replaceManagedUser(current, result.user));
      setLatestSetup(result);
    } catch (setupError) {
      setManagedUsersError(setupError instanceof Error ? setupError.message : "Failed to create setup link.");
    } finally {
      setPendingSetupUserId(undefined);
    }
  };

  const handleMembershipChange = async (
    userId: string,
    projectId: string,
    value: "none" | "member" | "admin" | "owner",
  ): Promise<void> => {
    setPendingMembershipKey(`${userId}:${projectId}`);
    setManagedUsersError(undefined);
    try {
      const updatedUser = await onSetManagedProjectMembership({
        userId,
        projectId,
        role: value === "none" ? undefined : value,
        remove: value === "none",
      });
      setManagedUsers((current) => replaceManagedUser(current, updatedUser));
    } catch (membershipError) {
      setManagedUsersError(membershipError instanceof Error ? membershipError.message : "Failed to update project access.");
    } finally {
      setPendingMembershipKey(undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div
          aria-label={`${auth.user.displayName} @${auth.user.handle}`}
          className="inline-flex max-w-[min(28rem,calc(100vw-2rem))] cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="button"
          tabIndex={0}
        >
          <UserRound size={16} />
          <span className="min-w-0 truncate font-medium">{auth.user.displayName}</span>
          <span className="min-w-0 truncate text-muted-foreground">@{auth.user.handle}</span>
          {auth.user.isAdmin ? (
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Admin
            </span>
          ) : null}
        </div>
      </DialogTrigger>
      <DialogContent className="flex h-[min(85vh,48rem)] min-h-0 flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            当前会话已登录。你现在可见 {auth.memberships.length} 个 project membership。
          </DialogDescription>
        </DialogHeader>
        <Tabs className="flex min-h-0 flex-1 flex-col overflow-hidden" value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full shrink-0 justify-start">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            {auth.user.isAdmin ? (
              <TabsTrigger value="users">
                <Users size={14} />
                Users
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1" value="profile">
            <form className="space-y-4" onSubmit={(event) => { void handleSave(event); }}>
              <div className="space-y-2">
                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Display name</p>
                <Input aria-label="Profile display name" autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Handle</p>
                <Input aria-label="Profile handle" value={handle} onChange={(event) => setHandle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Workspace role</p>
                  <Badge variant={auth.user.isAdmin ? "secondary" : "outline"}>
                    {auth.user.isAdmin ? "Admin" : "Member"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Project access</p>
                {auth.memberships.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {auth.memberships.map((membership) => (
                      <Badge key={membership.id} variant="outline">
                        {membership.projectName} · {membership.role}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted-foreground">No project memberships yet.</p>
                )}
              </div>
              {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
              <DialogFooter className="justify-between sm:justify-between">
                <Button disabled={loggingOut} onClick={() => void handleLogoutClick()} type="button" variant="ghost">
                  <LogOut size={16} />
                  {loggingOut ? "Logging out..." : "Logout"}
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Saving..." : "Save profile"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
          {auth.user.isAdmin ? (
            <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="users">
              <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                <Card className="shrink-0 border-border/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Shield size={16} />
                      Invite user
                    </CardTitle>
                    <CardDescription>
                      管理员只创建账号并生成 setup link；用户自己设置初始密码。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { void handleCreateUser(event); }}>
                      <div className="space-y-2">
                        <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Display name</p>
                        <Input aria-label="Managed user display name" value={createDisplayName} onChange={(event) => setCreateDisplayName(event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Handle</p>
                        <Input aria-label="Managed user handle" value={createHandle} onChange={(event) => setCreateHandle(event.target.value)} />
                      </div>
                      <div className="flex items-end justify-between rounded-xl border border-border/70 px-3 py-2 md:col-span-2">
                        <div className="space-y-1">
                          <p className="m-0 text-sm font-medium">Workspace admin</p>
                          <p className="m-0 text-xs text-muted-foreground">可管理用户、模板、全局配置和 project 创建。</p>
                        </div>
                        <Switch aria-label="Managed user admin" checked={createIsAdmin} onCheckedChange={setCreateIsAdmin} />
                      </div>
                      <div className="md:col-span-2">
                        <Button disabled={creatingUser} type="submit">
                          {creatingUser ? "Creating..." : "Create invite"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <Card className="shrink-0 border-border/80">
                  <CardHeader>
                    <CardTitle className="text-base">Latest setup link</CardTitle>
                    <CardDescription>
                      {latestSetup
                        ? `发给 ${latestSetup.user.displayName}（@${latestSetup.user.handle}）的 setup path / token。`
                        : "创建 invite 或重新生成 setup link 后，这里会显示最新的 setup path / token。"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Setup path</p>
                      <Input
                        aria-label="Latest setup path"
                        placeholder="Create an invite to generate a setup path"
                        readOnly
                        value={latestSetup?.setup.path ?? ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Setup token</p>
                      <Input
                        aria-label="Latest setup token"
                        placeholder="Create an invite to generate a setup token"
                        readOnly
                        value={latestSetup?.setup.token ?? ""}
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="min-h-5 shrink-0">
                  {managedUsersError ? <p className="m-0 text-sm text-destructive">{managedUsersError}</p> : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div aria-busy={loadingManagedUsers} className="space-y-3">
                    {loadingManagedUsers
                      ? Array.from({ length: 2 }, (_, index) => <ManagedUserLoadingCard key={index} index={index} />)
                      : null}

                    {!loadingManagedUsers && managedUsers.length === 0 ? (
                      <Card className="border-dashed border-border/80">
                        <CardContent className="py-6">
                          <p className="m-0 text-sm text-muted-foreground">No users yet. Create an invite above to provision the first managed account.</p>
                        </CardContent>
                      </Card>
                    ) : null}

                    {!loadingManagedUsers ? managedUsers.map((user) => {
                      const draft = userDrafts[user.id];
                      if (!draft) {
                        return null;
                      }

                      return (
                        <Card key={user.id} className="border-border/80">
                          <CardHeader>
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-base">{user.displayName}</CardTitle>
                              <Badge variant="outline">@{user.handle}</Badge>
                              {user.isAdmin ? <Badge variant="secondary">Admin</Badge> : null}
                              {user.setupPending ? <Badge variant="outline">Setup pending</Badge> : null}
                              {user.id === auth.user.id ? <Badge variant="outline">Current session</Badge> : null}
                            </div>
                            <CardDescription>
                              Created {user.createdAt}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-2">
                                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Display name</p>
                                <Input
                                  aria-label={`Managed display name ${user.handle}`}
                                  disabled={user.id === auth.user.id}
                                  value={draft.displayName}
                                  onChange={(event) =>
                                    setUserDrafts((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...current[user.id],
                                        displayName: event.target.value,
                                      },
                                    }))}
                                />
                              </div>
                              <div className="space-y-2">
                                <p className="m-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Handle</p>
                                <Input
                                  aria-label={`Managed handle ${user.handle}`}
                                  disabled={user.id === auth.user.id}
                                  value={draft.handle}
                                  onChange={(event) =>
                                    setUserDrafts((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...current[user.id],
                                        handle: event.target.value,
                                      },
                                    }))}
                                />
                              </div>
                              <div className="flex items-end md:justify-start">
                                <Button
                                  disabled={user.id === auth.user.id || pendingSetupUserId === user.id}
                                  onClick={() => void handleIssueSetup(user.id)}
                                  type="button"
                                  variant="outline"
                                >
                                  {pendingSetupUserId === user.id ? "Creating setup link..." : "Create setup link"}
                                </Button>
                              </div>
                              <div className="flex items-end justify-between rounded-xl border border-border/70 px-3 py-2">
                                <div className="space-y-1">
                                  <p className="m-0 text-sm font-medium">Workspace admin</p>
                                  <p className="m-0 text-xs text-muted-foreground">系统级权限，不等同于 project owner/admin。</p>
                                </div>
                                <Switch
                                  aria-label={`Managed admin ${user.handle}`}
                                  checked={draft.isAdmin}
                                  disabled={user.id === auth.user.id}
                                  onCheckedChange={(checked) =>
                                    setUserDrafts((current) => ({
                                      ...current,
                                      [user.id]: {
                                        ...current[user.id],
                                        isAdmin: checked,
                                      },
                                    }))}
                                />
                              </div>
                            </div>
                            {user.id === auth.user.id ? (
                              <p className="m-0 text-xs text-muted-foreground">当前登录账号请在 Profile 页签里修改，避免当前会话权限状态与编辑结果冲突。</p>
                            ) : null}
                            <div className="grid gap-3 md:grid-cols-2">
                              {availableProjects.map((project) => {
                                const currentRole = user.memberships.find((membership) => membership.projectId === project.id)?.role ?? "none";
                                const membershipKey = `${user.id}:${project.id}`;

                                return (
                                  <div key={project.id} className="space-y-2 rounded-xl border border-border/70 px-3 py-3">
                                    <div>
                                      <p className="m-0 text-sm font-medium">{project.name}</p>
                                      {project.path ? <p className="m-0 text-xs text-muted-foreground">{project.path}</p> : null}
                                    </div>
                                    <Select
                                      value={currentRole}
                                      onValueChange={(value) =>
                                        void handleMembershipChange(user.id, project.id, value as "none" | "member" | "admin" | "owner")}
                                    >
                                      <SelectTrigger aria-label={`Project access ${user.handle} ${project.name}`} className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">No access</SelectItem>
                                        <SelectItem value="member">Member</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="owner">Owner</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {pendingMembershipKey === membershipKey ? (
                                      <p className="m-0 text-xs text-muted-foreground">Saving access…</p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                          <CardFooter className="justify-end">
                            <Button disabled={user.id === auth.user.id || pendingUserId === user.id} onClick={() => void handleSaveManagedUser(user.id)} type="button">
                              {pendingUserId === user.id ? "Saving..." : "Save user"}
                            </Button>
                          </CardFooter>
                        </Card>
                      );
                    }) : null}
                  </div>
                </div>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
