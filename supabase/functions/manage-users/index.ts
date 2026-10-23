import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Perfil = "administrador" | "operador" | "consulta";
const validProfiles: Perfil[] = ["administrador", "operador", "consulta"];
const isPerfil = (x: string): x is Perfil => validProfiles.includes(x as Perfil);

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let j=9;j<11;j++) {
    let sum=0;for(let i=0;i<j;i++)sum+=Number(cpf[i])*(j+1-i);
    const digit=(sum*10)%11;
    if ((digit===10?0:digit)!==Number(cpf[j])) return false;
  }
  return true;
}
function borrowerData(body: any) {
  return { nome:String(body.name||'').trim(), cpf:String(body.cpf||'').replace(/[^0-9]/g,''), telefone:String(body.phone||'').trim() };
}
function validBorrower(d: ReturnType<typeof borrowerData>): boolean {
  return d.nome.length>=3 && d.nome.length<=150 && cpfValido(d.cpf) && d.telefone.length<=30;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return response({ error: "Variáveis do Supabase ausentes." }, 500);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return response({ error: "Faça login novamente." }, 401);
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // A identidade vem do JWT validado, nunca de campos no corpo da requisição.
    const { data: requester, error: roleError } = await admin.from("perfis_usuarios")
      .select("perfil").eq("usuario_id", authData.user.id).single();
    if (roleError || requester?.perfil !== "administrador") {
      return response({ error: "Somente administradores podem gerenciar usuários." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "list") {
      const users: any[] = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) return response({ error: error.message }, 400);
        users.push(...data.users);
        if (data.users.length < 100) break;
      }
      const { data: personal, error: personalError } = await admin.from("dados_retirantes").select("usuario_id,nome,cpf,telefone");
      if (personalError) return response({ error: personalError.message }, 400);
      const personalMap = new Map((personal || []).map((r) => [r.usuario_id, r]));
      const { data: roles, error: rolesError } = await admin.from("perfis_usuarios")
        .select("usuario_id,perfil");
      if (rolesError) return response({ error: rolesError.message }, 400);
      const map = new Map((roles || []).map((r) => [r.usuario_id, r.perfil]));
      return response({ users: users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: u.banned_until,
        user_metadata: u.user_metadata || {},
        perfil: map.get(u.id) || null,
        dados_retirante: personalMap.get(u.id) || null,
      })) });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const details = borrowerData(body);
      if (!validBorrower(details)) return response({ error: "Informe nome completo, CPF válido e telefone com até 30 caracteres." },400);
      const name = details.nome;
      const perfil = String(body.perfil || "consulta");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "E-mail inválido." }, 400);
      if (password.length < 8) return response({ error: "Senha deve ter no mínimo 8 caracteres." }, 400);
      if (!isPerfil(perfil)) return response({ error: "Perfil inválido." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: name ? { full_name: name } : {},
      });
      if (error || !data.user) return response({ error: error?.message || "Erro ao criar conta." }, 400);
      const { error: assignError } = await admin.from("perfis_usuarios")
        .upsert({ usuario_id: data.user.id, perfil, atualizado_em: new Date().toISOString() });
      if (assignError) {
        // Evita deixar uma conta criada sem perfil após erro inesperado.
        await admin.auth.admin.deleteUser(data.user.id);
        return response({ error: `Não foi possível atribuir o perfil: ${assignError.message}` }, 500);
      }
      const { error: detailsError } = await admin.from("dados_retirantes").upsert({usuario_id:data.user.id,...details});
      if (detailsError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return response({error:`Não foi possível salvar os dados: ${detailsError.message}`},500);
      }
      return response({ user: { id: data.user.id, email: data.user.email, perfil }, message: "Usuário criado." }, 201);
    }

    if (action === "details") {
      const userId=String(body.userId||"");
      const details=borrowerData(body);
      if (!validBorrower(details)) return response({error:"Informe nome completo e CPF válido."},400);
      const {data:target,error:targetError}=await admin.auth.admin.getUserById(userId);
      if(targetError||!target.user)return response({error:"Usuário não encontrado."},404);
      const {error}=await admin.from("dados_retirantes").upsert({usuario_id:userId,...details,atualizado_em:new Date().toISOString()});
      if(error)return response({error:error.message},400);
      return response({message:"Dados do retirante atualizados."});
    }
    if (action === "role") {
      const userId = String(body.userId || "");
      const perfil = String(body.perfil || "");
      if (!userId || !isPerfil(perfil)) return response({ error: "Usuário ou perfil inválido." }, 400);
      if (userId === authData.user.id && perfil !== "administrador")
        return response({ error: "Não é permitido retirar seu próprio perfil de administrador." }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { error } = await admin.from("perfis_usuarios")
        .upsert({ usuario_id: userId, perfil, atualizado_em: new Date().toISOString() });
      if (error) return response({ error: error.message }, 400);
      return response({ message: "Perfil alterado." });
    }

    if (action === "delete") {
      const userId = String(body.userId || "").trim();
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
        return response({ error: "Identificador de usuário inválido." }, 400);
      }
      if (userId === authData.user.id) {
        return response({ error: "Você não pode excluir sua própria conta." }, 400);
      }
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return response({ error: error.message }, 400);
      return response({ message: "Usuário excluído com sucesso." });
    }
    if (action === "access") {
      const userId = String(body.userId || "");
      const blocked = body.blocked === true;
      if (!userId) return response({ error: "Informe o usuário." }, 400);
      if (userId === authData.user.id) return response({ error: "Você não pode bloquear sua própria conta." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: blocked ? "876000h" : "none",
      });
      if (error) return response({ error: error.message }, 400);
      return response({ message: blocked ? "Conta bloqueada." : "Conta desbloqueada." });
    }

    if (action === "password") {
      const userId = String(body.userId || "");
      const password = String(body.password || "");
      if (!userId) return response({ error: "Informe o usuário." }, 400);
      if (password.length < 8) return response({ error: "Senha deve ter no mínimo 8 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return response({ error: error.message }, 400);
      return response({ message: "Senha atualizada." });
    }

    return response({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
