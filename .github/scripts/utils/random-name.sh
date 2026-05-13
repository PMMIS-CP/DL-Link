#!/usr/bin/env bash
# Random name generator for unique folder naming

RANDOM_WORDS=("alpha" "beta" "gamma" "delta" "epsilon" "zeta" "theta" "kappa" "lambda" "sigma" "omega" "nova" "star" "moon" "sun" "sky" "cloud" "river" "ocean" "mountain")

get_random_word() {
    echo "${RANDOM_WORDS[$RANDOM % ${#RANDOM_WORDS[@]}]}_$RANDOM"
}

get_unique_folder() {
    local BASE_PATH="$1"
    local BACKUP_DIR="$2"
    local NAME="$3"
    
    # Check both in downloads and backup dir
    if [ ! -d "$BASE_PATH/$NAME" ] && [ ! -d "$BACKUP_DIR/$NAME" ]; then
        echo "$NAME"
        return
    fi
    
    local RANDOM_SUFFIX
    RANDOM_SUFFIX=$(get_random_word)
    while [ -d "$BASE_PATH/${NAME}_${RANDOM_SUFFIX}" ] || [ -d "$BACKUP_DIR/${NAME}_${RANDOM_SUFFIX}" ]; do
        RANDOM_SUFFIX=$(get_random_word)
    done
    echo "${NAME}_${RANDOM_SUFFIX}"
}