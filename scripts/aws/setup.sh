#!/usr/bin/env bash
# One-time AWS setup for production (Lightsail). Idempotent — safe to rerun.
#
#   AWS_PROFILE=weatherslip scripts/aws/setup.sh                    # prints the account, does nothing
#   AWS_PROFILE=weatherslip CONFIRM_ACCOUNT=<id> scripts/aws/setup.sh infra
#   AWS_PROFILE=weatherslip CONFIRM_ACCOUNT=<id> scripts/aws/setup.sh env <file>
#
# `infra`: Lightsail container service + GitHub OIDC provider + deploy role.
# `env`:   copies KEY=VALUE lines from <file> into SSM SecureStrings under
#          /weather-slip/prod/ — the workflow passes them to the containers.
#          Keep <file> outside the repo and delete it afterwards.
# CONFIRM_ACCOUNT guards against running against the wrong AWS account.
set -euo pipefail

REGION=us-east-1
SERVICE=weather-slip
POWER=${POWER:-micro}
REPO=team-pixeledge/weather-slip
ROLE=weather-slip-github-deploy
PREFIX=/weather-slip/prod
export AWS_REGION=$REGION

# The machine's default profile belongs to a different AWS account — always
# name this project's profile explicitly.
case "${AWS_PROFILE:-default}" in
  default) echo "Set AWS_PROFILE (e.g. weatherslip); the default profile is another account." >&2; exit 1 ;;
esac

account=$(aws sts get-caller-identity --query Account --output text)
echo "AWS account: $account (profile ${AWS_PROFILE:-default}, region $REGION)"
if [ "${1:-}" = "" ]; then exit 0; fi
if [ "${CONFIRM_ACCOUNT:-}" != "$account" ]; then
  echo "Refusing: set CONFIRM_ACCOUNT=$account to act on this account." >&2
  exit 1
fi

infra() {
  if aws lightsail get-container-services --service-name "$SERVICE" >/dev/null 2>&1; then
    echo "Lightsail service $SERVICE exists"
  else
    aws lightsail create-container-service --service-name "$SERVICE" --power "$POWER" --scale 1 >/dev/null
    echo "Created Lightsail service $SERVICE ($POWER x1)"
  fi

  oidc_arn="arn:aws:iam::$account:oidc-provider/token.actions.githubusercontent.com"
  if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$oidc_arn" >/dev/null 2>&1; then
    echo "GitHub OIDC provider exists"
  else
    aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
      --client-id-list sts.amazonaws.com >/dev/null
    echo "Created GitHub OIDC provider"
  fi

  trust=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"$oidc_arn"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
   "token.actions.githubusercontent.com:sub":"repo:$REPO:ref:refs/heads/prod"}}}]}
JSON
)
  if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$trust"
  else
    aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$trust" >/dev/null
  fi
  policy=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["lightsail:RegisterContainerImage","lightsail:CreateContainerServiceRegistryLogin",
   "lightsail:CreateContainerServiceDeployment","lightsail:GetContainerServices",
   "lightsail:GetContainerServiceDeployments","lightsail:GetContainerImages"],"Resource":"*"},
 {"Effect":"Allow","Action":"ssm:GetParametersByPath",
   "Resource":"arn:aws:ssm:$REGION:$account:parameter$PREFIX"},
 {"Effect":"Allow","Action":"ssm:GetParameter*",
   "Resource":"arn:aws:ssm:$REGION:$account:parameter$PREFIX/*"}]}
JSON
)
  aws iam put-role-policy --role-name "$ROLE" --policy-name deploy --policy-document "$policy"
  echo "Deploy role: arn:aws:iam::$account:role/$ROLE  (put this in .github/workflows/deploy-prod.yml)"
}

put_env() {
  file=${1:?env file}
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    key=${line%%=*}; value=${line#*=}
    [ -n "$value" ] || { echo "skip $key (empty)"; continue; }
    aws ssm put-parameter --name "$PREFIX/$key" --type SecureString --value "$value" --overwrite >/dev/null
    echo "set $PREFIX/$key"
  done < "$file"
}

case "$1" in
  infra) infra ;;
  env) put_env "${2:-}" ;;
  *) echo "usage: $0 [infra | env <file>]" >&2; exit 1 ;;
esac
